import type { PlaybackState, QueueItem, RepeatMode } from "../../lib/types";
import { formatDuration } from "./format";
import { Icon } from "../../components/Icon";

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
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      {/* CENTER: transport */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          minWidth: 360,
        }}
      >
        <div className="transport">
          <button
            className={shuffle ? "ctrl on" : "ctrl"}
            title="Shuffle"
            onClick={onToggleShuffle}
          >
            <Icon name="shuffle" />
            {shuffle && <span className="dot" />}
          </button>
          <button className="ctrl bright" title="Previous" onClick={onPrevious} disabled={!canStart}>
            <Icon name="prev" size={22} />
          </button>
          {isPlaying ? (
            <button className="main" title="Pause" onClick={onPause} disabled={!hasTrack}>
              <Icon name="pause" size={20} />
            </button>
          ) : (
            <button className="main" title="Play" onClick={onPlay} disabled={!canStart}>
              <Icon name="play" size={20} />
            </button>
          )}
          <button className="ctrl bright" title="Next" onClick={onNext} disabled={!canStart}>
            <Icon name="next" size={22} />
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
        <Icon name="volume" size={16} />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="vol-slider"
          title="Volume (this device)"
        />
        <button className="iconbtn" title="Fullscreen video" onClick={onFullscreen}>
          <Icon name="fullscreen" />
        </button>
      </div>
    </div>
  );
}
