import type { ReactNode } from "react";
import type { QueueItem } from "../../lib/types";
import RetroWindow from "../../components/RetroWindow";

interface Props {
  roomName: string;
  /** Unused visually now (audio-only player is mounted in RoomPage), kept for compat. */
  playerSlot: ReactNode;
  active: boolean;
  nowPlaying: QueueItem | null;
}

// Right column — a poolsuite.net-style "album art" window showing what's
// currently spinning.
export default function RightPanel({ nowPlaying, active }: Props) {
  return (
    <aside className="desktop-col desktop-col-right">
      <RetroWindow title="now playing">
        <div style={{ display: "grid", gap: 14, justifyItems: "center", textAlign: "center" }}>
          {nowPlaying?.thumbnail_url ? (
            <img
              src={nowPlaying.thumbnail_url}
              alt=""
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                objectFit: "cover",
                borderRadius: 6,
                border: "2px solid var(--border)",
                boxShadow: "3px 3px 0 rgba(43,35,32,0.25)",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                background: "var(--panel-2)",
                borderRadius: 6,
                border: "2px solid var(--border)",
                display: "grid",
                placeItems: "center",
              }}
              className="muted pixel-heading"
            >
              ♪
            </div>
          )}
          <div>
            <div style={{ fontWeight: 700 }}>{nowPlaying ? nowPlaying.title : "Nothing playing"}</div>
            <div className="muted" style={{ marginTop: 2 }}>{nowPlaying?.artist}</div>
          </div>
          {!active && (
            <div className="muted" style={{ fontSize: 12 }}>
              Host is the speaker in this room
            </div>
          )}
        </div>
      </RetroWindow>
    </aside>
  );
}
