import type { PlaybackState, QueueItem, RepeatMode } from "../../lib/types";
import { formatDuration } from "./format";

interface Props {
  playback: PlaybackState | null | undefined;
  currentItem: QueueItem | null;
  hasQueued: boolean;
  positionMs: number;
  volume: number; // 0..100
  canRemoveCurrent: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onVolume: (v: number) => void;
  onRemoveCurrent: () => void;
  onFullscreen: () => void;
}

// Bottom player bar styled after Spotify: shuffle · prev · play/pause · next ·
// repeat in the center; track info + remove on the left; volume + fullscreen on
// the right. Anyone in the room can drive playback.
export default function PlayerBar({
  playback,
  currentItem,
  hasQueued,
  positionMs,
  volume,
  canRemoveCurrent,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  onSeek,
  onToggleShuffle,
  onCycleRepeat,
  onVolume,
  onRemoveCurrent,
  onFullscreen,
}: Props) {
  const isPlaying = playback?.is_playing ?? false;
  const hasTrack = !!currentItem;
  const canStart = hasTrack || hasQueued;
  const durationMs = currentItem?.duration_ms ?? 0;
  const shuffle = playback?.shuffle ?? false;
  const repeat: RepeatMode = playback?.repeat_mode ?? "off";

  return (
    <div className="playerbar">
      {/* LEFT: now playing + remove/add */}
      <div className="nowmeta">
        {currentItem?.thumbnail_url && (
          <img className="thumb" src={currentItem.thumbnail_url} alt="" width={48} height={48} />
        )}
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis">{currentItem?.title ?? "Nothing playing"}</div>
          <div className="muted ellipsis" style={{ fontSize: 13 }}>
            {currentItem?.artist ?? "Add a song to start"}
          </div>
        </div>
        {hasTrack && canRemoveCurrent && (
          <button className="iconbtn" title="Remove from queue" onClick={onRemoveCurrent}>
            ✕
          </button>
        )}
      </div>

      {/* CENTER: transport */}
      <div style={{ display: "grid", gap: 6, justifyItems: "center", minWidth: 320 }}>
        <div className="transport">
          <button
            className={shuffle ? "ctrl on" : "ctrl"}
            title="Shuffle"
            onClick={onToggleShuffle}
          >
            <Icon name="shuffle" />
            {shuffle && <span className="dot" />}
          </button>
          <button className="ctrl" title="Previous" onClick={onPrevious} disabled={!canStart}>
            <Icon name="prev" />
          </button>
          {isPlaying ? (
            <button className="main" title="Pause" onClick={onPause} disabled={!hasTrack}>
              <Icon name="pause" />
            </button>
          ) : (
            <button className="main" title="Play" onClick={onPlay} disabled={!canStart}>
              <Icon name="play" />
            </button>
          )}
          <button className="ctrl" title="Next" onClick={onNext} disabled={!canStart}>
            <Icon name="next" />
          </button>
          <button
            className={repeat !== "off" ? "ctrl on" : "ctrl"}
            title={`Repeat: ${repeat}`}
            onClick={onCycleRepeat}
          >
            <Icon name={repeat === "one" ? "repeat-one" : "repeat"} />
            {repeat !== "off" && <span className="dot" />}
          </button>
        </div>
        <div className="scrubber" style={{ width: "100%" }}>
          <span>{formatDuration(positionMs)}</span>
          <input
            type="range"
            min={0}
            max={durationMs || 1}
            value={Math.min(positionMs, durationMs || 1)}
            disabled={!hasTrack}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <span>{formatDuration(durationMs)}</span>
        </div>
      </div>

      {/* RIGHT: volume + fullscreen */}
      <div className="right-controls">
        <Icon name="volume" />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          style={{ width: 110, accentColor: "var(--accent)" }}
          title="Volume (this device)"
        />
        <button className="iconbtn" title="Fullscreen video" onClick={onFullscreen}>
          <Icon name="fullscreen" />
        </button>
      </div>
    </div>
  );
}

// Minimal inline SVG icon set (Spotify-ish).
function Icon({ name }: { name: string }) {
  const p: Record<string, string> = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    prev: "M6 6h2v12H6zm3.5 6 8.5 6V6z",
    next: "M16 6h2v12h-2zM6 18l8.5-6L6 6z",
    shuffle:
      "M17 3h4v4M21 3l-6 6M3 7h4l10 10h4m0 0v-4m0 4-4 0M3 17h4l3-3",
    repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
    "repeat-one":
      "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3M12 12v3m0-3-1 1",
    volume: "M11 5 6 9H2v6h4l5 4zM16 9a4 4 0 0 1 0 6",
    fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  };
  const fill = name === "play" || name === "pause" ? "currentColor" : "none";
  const stroke = fill === "none" ? "currentColor" : "none";
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={p[name]} />
    </svg>
  );
}
