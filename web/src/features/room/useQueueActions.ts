import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabaseClient";
import type { QueueItem, ResolvedTrack } from "../../lib/types";
import { myVotesKey, queueKey, sortQueue } from "./useRoomData";

// Re-export so callers can use the same sort when applying optimistic updates.
export { sortQueue };

// Mutations for the shared queue: add a resolved track, and upvote / retract.
// Realtime (useRoomChannel) is the source of truth — these mutations write to
// the DB and let the Postgres Changes echo patch every client (including us).
// Votes additionally get an optimistic local toggle so the UI feels instant.

interface UseQueueActionsArgs {
  roomId: string;
  userId: string;
}

export function useQueueActions({ roomId, userId }: UseQueueActionsArgs) {
  const qc = useQueryClient();

  const addTrack = useMutation({
    mutationFn: async (track: ResolvedTrack) => {
      const { error } = await supabase.from("queue_items").insert({
        room_id: roomId,
        added_by: userId,
        source: track.source,
        source_id: track.source_id,
        spotify_id: track.spotify_id,
        title: track.title,
        artist: track.artist,
        duration_ms: track.duration_ms,
        thumbnail_url: track.thumbnail_url,
      });
      if (error) throw error;
    },
  });

  const removeTrack = useMutation({
    mutationFn: async (itemId: string) => {
      // RLS allows deleting your own still-queued item (or host any).
      const { error } = await supabase.from("queue_items").delete().eq("id", itemId);
      if (error) throw error;
    },
  });

  // Toggle a vote. Optimistically flips membership in the my-votes set and nudges
  // the cached vote_count so the queue re-sorts immediately; the realtime echo
  // then reconciles to the authoritative count.
  const toggleVote = useMutation({
    mutationFn: async ({ itemId, voted }: { itemId: string; voted: boolean }) => {
      const rpc = voted ? "retract_vote" : "cast_vote";
      const { error } = await supabase.rpc(rpc, { p_item: itemId });
      if (error) throw error;
    },
    onMutate: async ({ itemId, voted }) => {
      await qc.cancelQueries({ queryKey: myVotesKey(roomId) });
      const prevVotes = qc.getQueryData<Set<string>>(myVotesKey(roomId));
      const prevQueue = qc.getQueryData<QueueItem[]>(queueKey(roomId));

      qc.setQueryData<Set<string>>(myVotesKey(roomId), (prev) => {
        const next = new Set(prev ?? []);
        if (voted) next.delete(itemId);
        else next.add(itemId);
        return next;
      });
      qc.setQueryData<QueueItem[]>(queueKey(roomId), (prev) => {
        if (!prev) return prev;
        const bumped = prev.map((q) =>
          q.id === itemId ? { ...q, vote_count: q.vote_count + (voted ? -1 : 1) } : q,
        );
        return sortQueue(bumped);
      });
      return { prevVotes, prevQueue };
    },
    onError: (_err, _vars, ctx) => {
      // roll back optimistic changes
      if (ctx?.prevVotes) qc.setQueryData(myVotesKey(roomId), ctx.prevVotes);
      if (ctx?.prevQueue) qc.setQueryData(queueKey(roomId), ctx.prevQueue);
    },
  });

  // Reorder: optimistically update local cache positions, then persist via RPC.
  const reorderQueue = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const { error } = await supabase.rpc("reorder_queue", {
        p_room: roomId,
        p_ids: orderedIds,
      });
      if (error) throw error;
    },
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: queueKey(roomId) });
      const prev = qc.getQueryData<QueueItem[]>(queueKey(roomId));
      qc.setQueryData<QueueItem[]>(queueKey(roomId), (old) => {
        if (!old) return old;
        const byId = new Map(old.map((q) => [q.id, q]));
        const reordered = orderedIds
          .map((id, i) => {
            const item = byId.get(id);
            return item ? { ...item, position: i } : null;
          })
          .filter((x): x is QueueItem => x !== null);
        // append any items not in the reorder list (shouldn't happen, but safe)
        const inSet = new Set(orderedIds);
        for (const item of old) {
          if (!inSet.has(item.id)) reordered.push(item);
        }
        return reordered;
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queueKey(roomId), ctx.prev);
    },
  });

  return { addTrack, removeTrack, toggleVote, reorderQueue };
}
