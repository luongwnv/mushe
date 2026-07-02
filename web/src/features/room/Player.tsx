import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ytReady } from "../../lib/ytApi";

// Imperative handle the room uses to drive the player from the sync loop and
// host controls. Wraps the YouTube IFrame player.
export interface PlayerHandle {
  load(videoId: string, startSeconds: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void; // 0..100
  getTimeMs(): number;
  getState(): YT.PlayerState | null;
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

// Audio-only: the iframe is rendered at 0x0 so only sound plays, no video.
const Player = forwardRef<PlayerHandle, Props>(function Player(
  { audible, volume, onReady, onEnded, onError },
  ref,
) {
  const hostElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  // keep latest callbacks/audibility without re-creating the player
  const cbs = useRef({ onReady, onEnded, onError });
  cbs.current = { onReady, onEnded, onError };
  const audibleRef = useRef(audible);
  audibleRef.current = audible;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    let destroyed = false;
    void ytReady().then((YT) => {
      if (destroyed || !hostElRef.current) return;
      playerRef.current = new YT.Player(hostElRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            // Ensure a sane starting volume and apply current audibility.
            const p = playerRef.current;
            if (p) {
              p.setVolume(100);
              if (audibleRef.current) p.unMute();
              else p.mute();
            }
            cbs.current.onReady?.();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) cbs.current.onEnded?.();
          },
          onError: (e) => cbs.current.onError?.(e.data),
        },
      });
    });
    return () => {
      destroyed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Mute entirely when this client shouldn't produce sound (e.g. a non-host in
  // host_only mode). When it should, leave loudness to setVolume() / the control
  // bar — just lift the mute so the slider takes effect.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    if (audible) {
      p.unMute();
      // Force YouTube to apply the current volume level after unmuting —
      // some browsers won't produce audio from unMute() alone.
      p.setVolume(p.getVolume());
    } else {
      p.mute();
    }
  }, [audible]);

  useImperativeHandle(
    ref,
    (): PlayerHandle => ({
      load(videoId, startSeconds) {
        const p = playerRef.current;
        if (!p) return;
        p.loadVideoById(videoId, startSeconds);
        // Re-apply volume and mute state after loadVideoById resets them.
        p.setVolume(volumeRef.current);
        if (audibleRef.current) p.unMute();
        else p.mute();
      },
      play() {
        playerRef.current?.playVideo();
      },
      pause() {
        playerRef.current?.pauseVideo();
      },
      seek(seconds) {
        playerRef.current?.seekTo(seconds, true);
      },
      setRate(rate) {
        playerRef.current?.setPlaybackRate(rate);
      },
      setVolume(volume) {
        const p = playerRef.current;
        if (!p) return;
        const v = Math.max(0, Math.min(100, volume));
        p.setVolume(v);
        // The control-bar slider is the single source of truth for loudness:
        // raising it must also lift YouTube's own mute, and dropping to 0 mutes.
        if (v === 0) p.mute();
        else p.unMute();
      },
      getTimeMs() {
        const p = playerRef.current;
        return p && readyRef.current ? Math.round(p.getCurrentTime() * 1000) : 0;
      },
      getState() {
        const p = playerRef.current;
        return p && readyRef.current ? p.getPlayerState() : null;
      },
      setMuted(muted) {
        const p = playerRef.current;
        if (!p) return;
        if (muted) p.mute();
        else p.unMute();
      },
    }),
    [audible],
  );

  return (
    <div style={{ width: 0, height: 0, overflow: "hidden" }}>
      <div ref={hostElRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default Player;
