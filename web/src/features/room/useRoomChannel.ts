import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";
import type { PlaybackState, PresenceMeta, QueueItem } from "../../lib/types";
import { playbackKey, queueKey, sortQueue } from "./useRoomData";

interface UseRoomChannelArgs {
  roomId: string | undefined;
  me: PresenceMeta | null;
}

interface UseRoomChannelResult {
  /** Live listeners currently connected (from Presence). */
  listeners: PresenceMeta[];
  /** Whether the channel has finished its initial SUBSCRIBE. */
  connected: boolean;
  /** The channel, for sending broadcasts (host transport in Phase 4). */
  channel: RealtimeChannel | null;
}

/**
 * Subscribes to the per-room realtime channel `room:{id}` and multiplexes:
 *  - Presence  → live listener roster
 *  - Postgres Changes on queue_items   → patch the queue cache + re-sort
 *  - Postgres Changes on playback_state → patch the playback cache
 *
 * Durable truth lives in TanStack Query (seeded by useRoomData); this hook only
 * applies deltas so every client converges without a full refetch per event.
 */
export function useRoomChannel({ roomId, me }: UseRoomChannelArgs): UseRoomChannelResult {
  const qc = useQueryClient();
  const [listeners, setListeners] = useState<PresenceMeta[]>([]);
  const [connected, setConnected] = useState(false);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  // Stabilize the presence payload across renders.
  const meKey = me ? `${me.user_id}|${me.display_name}|${me.avatar_url ?? ""}` : null;

  useEffect(() => {
    if (!roomId || !me) return;

    const ch = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: me.user_id } },
    });

    // --- Presence: live roster ---
    ch.on("presence", { event: "sync" }, () => {
      // Each presence entry is our PresenceMeta plus a Realtime presence_ref.
      const state = ch.presenceState<PresenceMeta>();
      const flat = Object.values(state)
        .map((entries) => entries[0])
        .filter((m): m is PresenceMeta & { presence_ref: string } => !!m);
      // de-dup by user_id (a user may have multiple tabs)
      const byUser = new Map<string, PresenceMeta>(
        flat.map((m) => [m.user_id, { user_id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }]),
      );
      setListeners([...byUser.values()]);
    });

    // --- queue_items deltas: patch + re-sort the queue cache ---
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` },
      (payload: RealtimePostgresChangesPayload<QueueItem>) => {
        qc.setQueryData<QueueItem[]>(queueKey(roomId), (prev) => {
          const list = prev ? [...prev] : [];
          const apply = (item: QueueItem): QueueItem[] => {
            const idx = list.findIndex((q) => q.id === item.id);
            const inView = item.status === "queued" || item.status === "playing";
            if (!inView) return list.filter((q) => q.id !== item.id);
            if (idx >= 0) list[idx] = item;
            else list.push(item);
            return list;
          };
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<QueueItem>).id;
            return list.filter((q) => q.id !== oldId);
          }
          return sortQueue(apply(payload.new as QueueItem));
        });
      },
    );

    // --- playback_state deltas: patch the playback cache ---
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "playback_state", filter: `room_id=eq.${roomId}` },
      (payload: RealtimePostgresChangesPayload<PlaybackState>) => {
        if (payload.eventType === "DELETE") {
          qc.setQueryData(playbackKey(roomId), null);
        } else {
          qc.setQueryData(playbackKey(roomId), payload.new as PlaybackState);
        }
      },
    );

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnected(true);
        void ch.track(me);
      }
    });

    setChannel(ch);

    return () => {
      void ch.untrack();
      void supabase.removeChannel(ch);
      setChannel(null);
      setConnected(false);
      setListeners([]);
    };
    // meKey captures presence-identity changes; roomId/qc are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, meKey, qc]);

  return { listeners, connected, channel };
}
