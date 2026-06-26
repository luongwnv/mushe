import { useEffect, useRef } from "react";
import {
  driftCorrection,
  expectedPositionMs,
  isoToServerMs,
  type PlaybackClock,
} from "../../lib/sync";
import type { PlaybackState, QueueItem } from "../../lib/types";
import type { PlayerHandle } from "./Player";

// Drives the local player to match the shared playback_state. Used by every
// client that mounts an audible/active player (host always; followers in synced
// mode). The host's own player is also driven here so its actions take effect;
// since the host authors playback_state, there's no fighting — it just obeys
// the state it just wrote.

interface Args {
  player: PlayerHandle | null;
  playerReady: boolean;
  playback: PlaybackState | null | undefined;
  currentItem: QueueItem | null;
  /** Whether the user has completed the "tap to listen" gesture (autoplay unlock). */
  unlocked: boolean;
  active: boolean; // should this client run the loop at all
}

function toClock(p: PlaybackState): PlaybackClock {
  return {
    isPlaying: p.is_playing,
    positionMs: p.position_ms,
    startedAtServerMs: isoToServerMs(p.started_at),
  };
}

export function usePlaybackSync({
  player,
  playerReady,
  playback,
  currentItem,
  unlocked,
  active,
}: Args) {
  // Track which video is loaded so we only call loadVideoById on change.
  const loadedVideoRef = useRef<string | null>(null);

  // Load / switch track when the current item changes.
  useEffect(() => {
    // Wait for the autoplay-unlock gesture so loadVideoById can play with sound.
    if (!player || !playerReady || !active || !unlocked) return;
    const videoId = currentItem?.source_id ?? null;
    if (videoId && videoId !== loadedVideoRef.current) {
      loadedVideoRef.current = videoId;
      const startMs = playback ? expectedPositionMs(toClock(playback)) : 0;
      player.load(videoId, Math.max(0, startMs / 1000)); // loadVideoById autoplays
      // If the shared state says paused, immediately pause after the load.
      if (playback && !playback.is_playing) {
        setTimeout(() => player.pause(), 300);
      }
    } else if (!videoId) {
      loadedVideoRef.current = null;
    }
    // playback read at load time only; re-run when the track or unlock changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, playerReady, active, unlocked, currentItem?.source_id]);

  // Drift-correction loop (~1s). Reconciles play/pause + position to the clock.
  useEffect(() => {
    if (!player || !playerReady || !active || !unlocked || !playback) return;
    if (!currentItem) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let softResetAt = 0;

    const tick = () => {
      const clock = toClock(playback);
      const expected = expectedPositionMs(clock);
      const local = player.getTimeMs();
      const YTns = window.YT;
      const state = player.getState();

      // pause/play reconcile
      if (!clock.isPlaying) {
        if (YTns && state === YTns.PlayerState.PLAYING) player.pause();
        return;
      }
      if (YTns && (state === YTns.PlayerState.PAUSED || state === YTns.PlayerState.CUED)) {
        player.play();
      }

      const action = driftCorrection(expected, local);
      if (action.kind === "hard") {
        player.seek(action.targetMs / 1000);
        player.setRate(1.0);
      } else if (action.kind === "soft") {
        player.setRate(action.rate);
        softResetAt = Date.now() + 2000; // hold the nudge briefly
      } else if (softResetAt && Date.now() > softResetAt) {
        player.setRate(1.0);
        softResetAt = 0;
      }
    };

    // react immediately to a new playback state, then poll
    tick();
    timer = setInterval(tick, 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [player, playerReady, active, unlocked, playback, currentItem]);
}
