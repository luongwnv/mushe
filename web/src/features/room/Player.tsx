import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { env } from "../../lib/env";

// Mirrors the subset of YT.PlayerState values usePlaybackSync/RoomPage
// compare against, so the sync loop's state machine didn't need to change
// when the backing player switched from the YouTube IFrame to a native
// <audio> element.
export const PlayerState = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;
export type PlayerStateValue = (typeof PlayerState)[keyof typeof PlayerState];

// Imperative handle the room uses to drive the player from the sync loop and
// host controls. Wraps a native <audio> element streaming from the server's
// /stream/:videoId proxy (yt-dlp + ffmpeg, cached) — no YouTube embed, so no
// ads and no ad-driven desync between clients.
export interface PlayerHandle {
  load(videoId: string, startSeconds: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void; // 0..100
  getTimeMs(): number;
  getState(): PlayerStateValue | null;
  setMuted(muted: boolean): void;
}

interface Props {
  /** Whether this client should produce sound (host always; followers in synced mode). */
  audible: boolean;
  volume: number; // 0..100, re-applied on every track load
  onReady?: () => void;
  onEnded?: () => void;
  onError?: (code: number) => void;
}

const Player = forwardRef<PlayerHandle, Props>(function Player(
  { audible, volume, onReady, onEnded, onError },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const readyRef = useRef(false);
  const pendingStartSecondsRef = useRef(0);
  const cbs = useRef({ onReady, onEnded, onError });
  cbs.current = { onReady, onEnded, onError };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    // The handle is usable as soon as the <audio> element is mounted — unlike
    // the YouTube IFrame API (which needed an external script to finish
    // loading), there's nothing to wait for here. Signaling ready immediately
    // lets usePlaybackSync call load() on the first render instead of
    // deadlocking on a "canplay" event that a src-less <audio> never fires.
    if (!readyRef.current) {
      readyRef.current = true;
      cbs.current.onReady?.();
    }

    const handleLoadedMetadata = () => {
      if (pendingStartSecondsRef.current > 0) {
        el.currentTime = pendingStartSecondsRef.current;
        pendingStartSecondsRef.current = 0;
      }
    };
    const handleEnded = () => cbs.current.onEnded?.();
    const handleError = () => {
      // MediaError has no YouTube-shaped numeric codes; RoomPage treats any
      // code outside {101, 150} as a generic "couldn't play" skip, so 0 is fine.
      cbs.current.onError?.(0);
    };

    el.addEventListener("loadedmetadata", handleLoadedMetadata);
    el.addEventListener("ended", handleEnded);
    el.addEventListener("error", handleError);
    return () => {
      el.removeEventListener("loadedmetadata", handleLoadedMetadata);
      el.removeEventListener("ended", handleEnded);
      el.removeEventListener("error", handleError);
    };
  }, []);

  // Mute entirely when this client shouldn't produce sound (e.g. a non-host in
  // host_only mode).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !audible;
  }, [audible]);

  useImperativeHandle(
    ref,
    (): PlayerHandle => ({
      load(videoId, startSeconds) {
        const el = audioRef.current;
        if (!el) return;
        pendingStartSecondsRef.current = startSeconds;
        el.src = `${env.resolverUrl}/stream/${videoId}`;
        el.volume = Math.max(0, Math.min(100, volume)) / 100;
        el.muted = !audible;
        el.load();
        void el.play().catch(() => {
          // Autoplay may be blocked until the user's unlock gesture; the sync
          // loop retries play() on its next tick.
        });
      },
      play() {
        void audioRef.current?.play().catch(() => {});
      },
      pause() {
        audioRef.current?.pause();
      },
      seek(seconds) {
        const el = audioRef.current;
        if (!el) return;
        el.currentTime = seconds;
      },
      setRate(rate) {
        const el = audioRef.current;
        if (el) el.playbackRate = rate;
      },
      setVolume(vol) {
        const el = audioRef.current;
        if (!el) return;
        const v = Math.max(0, Math.min(100, vol));
        el.volume = v / 100;
      },
      getTimeMs() {
        const el = audioRef.current;
        return el && readyRef.current ? Math.round(el.currentTime * 1000) : 0;
      },
      getState() {
        const el = audioRef.current;
        if (!el || !readyRef.current) return null;
        if (el.ended) return PlayerState.ENDED;
        if (el.paused) return PlayerState.PAUSED;
        if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return PlayerState.BUFFERING;
        return PlayerState.PLAYING;
      },
      setMuted(muted) {
        const el = audioRef.current;
        if (el) el.muted = muted;
      },
    }),
    [audible, volume],
  );

  return <audio ref={audioRef} style={{ display: "none" }} preload="auto" />;
});

export default Player;
