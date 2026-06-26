import type { PlaybackMode, PlaybackState, QueueItem } from "../../lib/types";

interface Props {
  playback: PlaybackState | null | undefined;
  currentItem: QueueItem | null;
  hasQueued: boolean;
  mode: PlaybackMode;
  /** Local player position (ms) for play/pause anchoring. */
  positionMs: number;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  onSeek: (positionMs: number) => void;
  onChangeMode: (mode: PlaybackMode) => void;
}

// Host-only transport controls. Members see playback but can't drive it
// (RLS rejects their writes anyway); we just don't render this for them.
export default function HostControls({
  playback,
  currentItem,
  hasQueued,
  mode,
  positionMs,
  onPlay,
  onPause,
  onSkip,
  onSeek,
  onChangeMode,
}: Props) {
  const isPlaying = playback?.is_playing ?? false;
  const hasTrack = !!currentItem;
  const canStart = hasTrack || hasQueued;
  const durationMs = currentItem?.duration_ms ?? 0;

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        {isPlaying ? (
          <button onClick={onPause} disabled={!hasTrack}>
            ⏸ Pause
          </button>
        ) : (
          <button onClick={onPlay} disabled={!canStart}>
            ▶ Play
          </button>
        )}
        <button className="secondary" onClick={onSkip} disabled={!canStart}>
          ⏭ Skip
        </button>

        <span style={{ flex: 1 }} />

        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <span className="muted">Mode</span>
          <select
            value={mode}
            onChange={(e) => onChangeMode(e.target.value as PlaybackMode)}
            style={{
              background: "var(--panel-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <option value="synced">Synced (every device)</option>
            <option value="host_only">Host only (one speaker)</option>
          </select>
        </label>
      </div>

      {hasTrack && durationMs > 0 && (
        <input
          type="range"
          min={0}
          max={durationMs}
          value={Math.min(positionMs, durationMs)}
          onChange={(e) => onSeek(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      )}
    </div>
  );
}
