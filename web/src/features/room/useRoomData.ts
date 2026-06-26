import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabaseClient";
import type { PlaybackState, QueueItem } from "../../lib/types";

// Seed fetches for a room. Realtime (useRoomChannel) patches these caches as
// deltas arrive; these queries provide the authoritative starting point and the
// recovery state on reconnect.

export function queueKey(roomId: string) {
  return ["queue", roomId] as const;
}
export function playbackKey(roomId: string) {
  return ["playback", roomId] as const;
}
export function myVotesKey(roomId: string) {
  return ["my-votes", roomId] as const;
}

/** Active queue (queued + the currently playing item), ordered for display. */
export function useQueue(roomId: string | undefined) {
  return useQuery({
    queryKey: queueKey(roomId ?? "none"),
    enabled: !!roomId,
    queryFn: async (): Promise<QueueItem[]> => {
      const { data, error } = await supabase
        .from("queue_items")
        .select("*")
        .eq("room_id", roomId!)
        .in("status", ["queued", "playing"])
        .order("vote_count", { ascending: false })
        .order("added_at", { ascending: true });
      if (error) throw error;
      return data as QueueItem[];
    },
  });
}

/** The room's single playback_state row. */
export function usePlayback(roomId: string | undefined) {
  return useQuery({
    queryKey: playbackKey(roomId ?? "none"),
    enabled: !!roomId,
    queryFn: async (): Promise<PlaybackState | null> => {
      const { data, error } = await supabase
        .from("playback_state")
        .select("*")
        .eq("room_id", roomId!)
        .maybeSingle();
      if (error) throw error;
      return (data as PlaybackState) ?? null;
    },
  });
}

/** Set of queue_item ids the current user has upvoted (for highlight + toggle). */
export function useMyVotes(roomId: string | undefined) {
  return useQuery({
    queryKey: myVotesKey(roomId ?? "none"),
    enabled: !!roomId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("votes")
        .select("queue_item_id")
        .eq("room_id", roomId!);
      if (error) throw error;
      return new Set((data as { queue_item_id: string }[]).map((v) => v.queue_item_id));
    },
  });
}

/** Stable comparator matching the SQL ordering (votes desc, then added asc). */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
    return a.added_at < b.added_at ? -1 : a.added_at > b.added_at ? 1 : 0;
  });
}
