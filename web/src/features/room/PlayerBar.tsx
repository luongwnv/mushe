import type { PlaybackMode, PlaybackState, QueueItem } from "../../lib/types";
import { formatDuration } from "./format";

interface Props {
  isHost: boolean;
  playback: PlaybackState | null | undefined;
  currentItem: QueueItem | null;
  hasQueued: boolean;
  mode: PlaybackMode;
  positionMs: number;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  onSeek: (positionMs: number) => void;
  onChangeMode: (mode: PlaybackMode) => void;
}

// Bottom fixed bar (Spotify-style): now-playing (left), transport (center),
// mode + scrubber (right). Transport is host-only; members see state read-only.
export default function PlayerBar({
  isHost,
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
    <div className="playerbar">
      {/* left: now playing */}
      <div className="nowmeta">
        {currentItem?.thumbnail_url && (
          <img className="thumb" src={currentItem.thumbnail_url} alt="" width={48} height={48} />
        )}
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis">{currentItem?.title ?? "Nothing playing"}</div>
          <div className="muted ellipsis" style={{ fontSize: 13 }}>
            {currentItem?.artist ?? (isHost ? "Add a song and press play" : "Waiting for host")}
          </div>
        </div>
      </div>

      {/* center: transport */}
      <div style={{ display: "grid", gap: 6, justifyItems: "center", minWidth: 280 }}>
        <div className="transport">
          <button
            className="ctrl"
            title="Skip"
            onClick={onSkip}
            disabled={!isHost || !canStart}
          >
            ⏭
          </button>
          {isPlaying ? (
            <button
              className="main"
              title="Pause"
              onClick={onPause}
              disabled={!isHost || !hasTrack}
            >
              ⏸
            </button>
          ) : (
            <button
              className="main"
              title="Play"
              onClick={onPlay}
              disabled={!isHost || !canStart}
            >
              ▶
            </button>
          )}
          <span style={{ width: 18 }} />
        </div>
        <div className="scrubber" style={{ width: "100%" }}>
          <span>{formatDuration(positionMs)}</span>
          <input
            type="range"
            min={0}
            max={durationMs || 1}
            value={Math.min(positionMs, durationMs || 1)}
            disabled={!isHost || !hasTrack}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <span>{formatDuration(durationMs)}</span>
        </div>
      </div>

      {/* right: mode toggle (host only) */}
      <div className="right-controls">
        {isHost ? (
          <select
            className="select"
            value={mode}
            onChange={(e) => onChangeMode(e.target.value as PlaybackMode)}
            title="Playback mode"
          >
            <option value="synced">🔊 Synced (all devices)</option>
            <option value="host_only">🎧 Host only</option>
          </select>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>
            {mode === "synced" ? "Synced playback" : "Host is the speaker"}
          </span>
        )}
      </div>
    </div>
  );
}
