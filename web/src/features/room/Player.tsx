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
  onReady?: () => void;
  onEnded?: () => void;
  onError?: (code: number) => void;
}

// Per YouTube ToS the player must stay visible/unobscured. We render a real,
// modest-sized player rather than hiding it.
const Player = forwardRef<PlayerHandle, Props>(function Player(
  { audible, onReady, onEnded, onError },
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

  useEffect(() => {
    let destroyed = false;
    void ytReady().then((YT) => {
      if (destroyed || !hostElRef.current) return;
      playerRef.current = new YT.Player(hostElRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
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

  // Apply mute state when audibility changes.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    if (audible) {
      p.unMute();
      if (p.getVolume() === 0) p.setVolume(100);
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
        if (audible) p.unMute();
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
        playerRef.current?.setVolume(Math.max(0, Math.min(100, volume)));
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
    <div
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        maxWidth: 480,
        background: "#000",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div ref={hostElRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default Player;
