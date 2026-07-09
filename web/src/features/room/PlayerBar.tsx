import { useEffect, useRef, useState } from "react";
import type { PlaybackState, QueueItem } from "../../lib/types";
import { formatDuration } from "./format";
import { Icon } from "../../components/Icon";
import { Marquee } from "../../components/Marquee";

interface Props {
  playback: PlaybackState | null | undefined;
  currentItem: QueueItem | null;
  nextItem: QueueItem | null;
  hasQueued: boolean;
  positionMs: number;
  volume: number; // 0..100
  canRemoveCurrent: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  onVolume: (v: number) => void;
  onRemoveCurrent: () => void;
}

// A faithful recreation of poolsuite.net's compact "ON AIR" mini player
// chrome: a track-info card with a notch cut out of its bottom-right
// corner (transport controls float inside that notch), an up-next row,
// and a dot-textured volume slider below. Same collaborative playback
// logic as before — seek/volume/queue-remove — just wearing that skin.
// Anyone in the room can drive playback.
export default function PlayerBar({
  playback,
  currentItem,
  nextItem,
  hasQueued,
  positionMs,
  volume,
  canRemoveCurrent,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  onSeek,
  onVolume,
  onRemoveCurrent,
}: Props) {
  const isPlaying = playback?.is_playing ?? false;
  const hasTrack = !!currentItem;
  const canStart = hasTrack || hasQueued;
  const durationMs = currentItem?.duration_ms ?? 0;
  const title = currentItem?.title ?? "Nothing playing";
  const artist = currentItem?.artist ?? "Add a song below to start";
  const nextLabel = nextItem ? `${nextItem.artist ? `${nextItem.artist} – ` : ""}${nextItem.title}` : "Queue is empty";

  const sliderTrackRef = useRef<HTMLDivElement>(null);
  const [draggingVolume, setDraggingVolume] = useState(false);
  const [pressedButton, setPressedButton] = useState<"prev" | "next" | null>(null);

  useEffect(() => {
    if (!draggingVolume) return;
    function setFromClientX(clientX: number) {
      const el = sliderTrackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onVolume(Math.round(pct * 100));
    }
    function handleMove(event: MouseEvent) {
      setFromClientX(event.clientX);
    }
    function handleUp() {
      setDraggingVolume(false);
    }
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [draggingVolume, onVolume]);

  return (
    <section className="onair">
      {/* Track info panel: a full rectangle with a continuous border
          (rounded corners on all 4 sides). A same-color-as-outer-background
          "notch" rectangle is layered on top of its bottom-right corner,
          visually cutting that corner away — this is what creates the
          L-shape. The transport controls float inside that notch, outside
          the white area (never layered on the white background itself). */}
      <div className="onair-card">
        <div className="row onair-cardtop">
          <span className="onair-cardtitle">
            mushe: ON AIR
            {isPlaying && <span aria-hidden className="onair-live-dot" />}
          </span>
        </div>

        <Marquee text={`${artist} – ${title}`} className="onair-cardsubtitle" />

        <div className="onair-status">
          <div className="row" style={{ gap: 6 }}>
            <Icon name="play" size={13} />
            <span className="onair-status-label">
              {isPlaying ? "Playing" : hasTrack ? "Paused" : "Stopped"}
            </span>
            <span className="onair-status-time">
              {hasTrack ? `${formatDuration(positionMs)} / ${formatDuration(durationMs)}` : "Live"}
            </span>
          </div>
        </div>

        {/* thin poolsuite-style progress line; click/drag to seek */}
        <div className="onair-progress">
          <input
            type="range"
            min={0}
            max={durationMs || 1}
            value={Math.min(positionMs, durationMs || 1)}
            disabled={!hasTrack}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Seek"
          />
          <div
            className="onair-progress-fill"
            style={{ width: `${durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0}%` }}
          />
        </div>

        {/* Notch: cream-colored rectangle covering the panel's bottom-right
            corner, cutting it away visually. Extends past the panel's own
            border on the bottom/right so the cut edge looks clean. */}
        <div aria-hidden className="onair-notch" />

        {/* Transport controls — sit inside the notch, outside the white panel. */}
        <div className="onair-transport">
          <div className="onair-transport-group">
            {isPlaying ? (
              <button className="onair-btn active" title="Pause" onClick={onPause} disabled={!hasTrack}>
                <Icon name="pause" size={20} />
              </button>
            ) : (
              <button className="onair-btn active" title="Play" onClick={onPlay} disabled={!canStart}>
                <Icon name="play" size={20} />
              </button>
            )}
            <button className="onair-btn" title="Stop" onClick={onPause} disabled={!isPlaying}>
              <Icon name="stop" size={18} />
            </button>
            <button
              className={pressedButton === "prev" ? "onair-btn media-btn-pressed" : "onair-btn"}
              title="Previous"
              onClick={onPrevious}
              onMouseDown={() => setPressedButton("prev")}
              onMouseUp={() => setPressedButton(null)}
              onMouseLeave={() => setPressedButton((current) => (current === "prev" ? null : current))}
              disabled={!canStart}
            >
              <Icon name="prev" size={20} />
            </button>
            <button
              className={pressedButton === "next" ? "onair-btn media-btn-pressed" : "onair-btn"}
              title="Next"
              onClick={onNext}
              onMouseDown={() => setPressedButton("next")}
              onMouseUp={() => setPressedButton(null)}
              onMouseLeave={() => setPressedButton((current) => (current === "next" ? null : current))}
              disabled={!canStart}
            >
              <Icon name="next" size={20} />
            </button>
          </div>

          <button
            className="onair-addbtn"
            title="Remove current from queue"
            onClick={onRemoveCurrent}
            disabled={!hasTrack || !canRemoveCurrent}
          >
            <Icon name="note-plus" size={22} />
          </button>
        </div>
      </div>

      {/* Row 2: up-next track (left, flexible) + volume (right, matches
          the transport-controls column width) */}
      <div className="onair-footer">
        <div className="onair-channel-wrap">
          <div className="onair-channel">
            <span style={{ flex: "none" }}>Next:&nbsp;</span>
            <Marquee text={nextLabel} className="onair-next-label" />
          </div>
        </div>

        {/* Volume slider — a dot-grid background, with a cream
            "track-filled" panel (with speaker icon) that COVERS the used
            portion, revealing dot texture only on the unused right side. */}
        <div
          ref={sliderTrackRef}
          role="slider"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={volume}
          tabIndex={0}
          onMouseDown={(event) => {
            setDraggingVolume(true);
            const rect = event.currentTarget.getBoundingClientRect();
            const pct = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            onVolume(Math.round(pct * 100));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") onVolume(Math.min(100, volume + 5));
            if (event.key === "ArrowLeft") onVolume(Math.max(0, volume - 5));
          }}
          className="onair-volbox"
        >
          <div className="onair-volfill" style={{ width: `${volume}%` }}>
            <Icon name="volume" size={17} />
          </div>
        </div>
      </div>
    </section>
  );
}
