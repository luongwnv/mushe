import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabaseClient";
import type { Room } from "../../lib/types";

/** True only for the signed-in profile flagged is_admin in Postgres (RLS-enforced). */
export function useIsAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "is-admin", userId],
    enabled: !!userId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return !!(data as { is_admin: boolean }).is_admin;
    },
  });
}

export interface RoomWithCounts extends Room {
  member_count: number;
  queued_count: number;
}

const roomsKey = ["admin", "rooms"] as const;

/** Every active room plus its member/queue counts (admin-only via RLS). */
export function useAdminRooms(enabled: boolean) {
  return useQuery({
    queryKey: roomsKey,
    enabled,
    refetchInterval: 15_000,
    queryFn: async (): Promise<RoomWithCounts[]> => {
      const { data: rooms, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const roomList = rooms as Room[];
      if (roomList.length === 0) return [];

      const roomIds = roomList.map((r) => r.id);
      const [{ data: members, error: mErr }, { data: queue, error: qErr }] = await Promise.all([
        supabase.from("room_members").select("room_id").in("room_id", roomIds),
        supabase.from("queue_items").select("room_id").eq("status", "queued").in("room_id", roomIds),
      ]);
      if (mErr) throw mErr;
      if (qErr) throw qErr;

      const memberCounts = new Map<string, number>();
      for (const m of members as { room_id: string }[]) {
        memberCounts.set(m.room_id, (memberCounts.get(m.room_id) ?? 0) + 1);
      }
      const queueCounts = new Map<string, number>();
      for (const q of queue as { room_id: string }[]) {
        queueCounts.set(q.room_id, (queueCounts.get(q.room_id) ?? 0) + 1);
      }

      return roomList.map((r) => ({
        ...r,
        member_count: memberCounts.get(r.id) ?? 0,
        queued_count: queueCounts.get(r.id) ?? 0,
      }));
    },
  });
}

export async function clearRoom(roomId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_clear_room", { p_room: roomId });
  if (error) throw error;
}

/**
 * Counts live listeners across a set of rooms by briefly joining each room's
 * Realtime Presence channel (the same mechanism RoomPage uses) in read-only
 * mode — no track() call, so the admin doesn't show up as a listener.
 * Presence is ephemeral and per-channel, so this is the only way to observe
 * "who's connected right now" without adding a server-side heartbeat.
 */
export function useActiveListeners(roomIds: string[]) {
  const [perRoom, setPerRoom] = useState<Map<string, number>>(new Map());
  const idsKey = roomIds.slice().sort().join(",");

  useEffect(() => {
    if (!idsKey) {
      setPerRoom(new Map());
      return;
    }
    const ids = idsKey.split(",");
    const channels = ids.map((roomId) => {
      const ch = supabase.channel(`room:${roomId}`, { config: { presence: { key: "admin-observer" } } });
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        setPerRoom((prev) => {
          const next = new Map(prev);
          next.set(roomId, Object.keys(state).length);
          return next;
        });
      });
      ch.subscribe();
      return ch;
    });

    return () => {
      for (const ch of channels) void supabase.removeChannel(ch);
      setPerRoom(new Map());
    };
  }, [idsKey]);

  const total = [...perRoom.values()].reduce((sum, n) => sum + n, 0);
  return { perRoom, total };
}
