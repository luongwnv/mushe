import { useMutation } from "@tanstack/react-query";
import { supabase } from "../../lib/supabaseClient";
import { serverNowIso } from "../../lib/sync";
import type { PlaybackState } from "../../lib/types";

// Host-only transport. Only the host's writes to playback_state move the shared
// clock (enforced by RLS). The position anchor (started_at + position_ms) is set
// in server time via the DB default now()/explicit timestamps, so every follower
// computes the same target position. Skip/track-end go through advance_track.

interface Args {
  roomId: string;
  currentItemId: string | null;
}

// Patch playback_state. We send position_ms + started_at so followers can
// recompute. started_at is set to the DB clock by passing now() via an RPC-free
// update: we let Postgres stamp updated_at and started_at using the server's
// now() by sending the ISO string from a server-time RPC is overkill for MVP —
// instead we anchor on the row's updated_at (server-set) and store position_ms.
async function patchPlayback(roomId: string, patch: Partial<PlaybackState>) {
  const { error } = await supabase
    .from("playback_state")
    .update(patch)
    .eq("room_id", roomId);
  if (error) throw error;
}

export function usePlaybackActions({ roomId, currentItemId }: Args) {
  // Resume / start playing from a given position.
  const play = useMutation({
    mutationFn: async (positionMs: number) => {
      await patchPlayback(roomId, {
        is_playing: true,
        position_ms: Math.round(positionMs),
        started_at: serverNowIso(),
        updated_at: serverNowIso(),
      });
    },
  });

  const pause = useMutation({
    mutationFn: async (positionMs: number) => {
      await patchPlayback(roomId, {
        is_playing: false,
        position_ms: Math.round(positionMs),
        started_at: null,
        updated_at: serverNowIso(),
      });
    },
  });

  const seek = useMutation({
    mutationFn: async ({ positionMs, isPlaying }: { positionMs: number; isPlaying: boolean }) => {
      await patchPlayback(roomId, {
        position_ms: Math.round(positionMs),
        started_at: isPlaying ? serverNowIso() : null,
        updated_at: serverNowIso(),
      });
    },
  });

  // Advance to the next (highest-voted) track. Idempotent via the expected id.
  const next = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("advance_track", {
        p_room: roomId,
        p_expected_current: currentItemId,
      });
      if (error) throw error;
    },
  });

  return { play, pause, seek, next };
}
