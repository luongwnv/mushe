import type { ReactNode } from "react";
import type { PresenceMeta, QueueItem } from "../../lib/types";

interface Props {
  roomName: string;
  /** The <Player> element (rendered by the parent so it can hold the ref). */
  playerSlot: ReactNode;
  /** Whether this client mounts an audible player (host, or follower in synced). */
  active: boolean;
  nowPlaying: QueueItem | null;
  listeners: PresenceMeta[];
  hostId: string;
}

// Right column — mirrors Spotify's "Now playing" panel: the video/player on top,
// current track info, then who's listening.
export default function RightPanel({
  roomName,
  playerSlot,
  active,
  nowPlaying,
  listeners,
  hostId,
}: Props) {
  return (
    <aside className="col col-right">
      <div className="col-scroll" style={{ display: "grid", gap: 18 }}>
        <div className="muted" style={{ fontWeight: 700, color: "var(--text)" }}>
          {roomName}
        </div>

        {/* The player lives here (visible, per YouTube ToS). */}
        {active ? (
          playerSlot
        ) : (
          <div
            style={{
              aspectRatio: "16 / 9",
              background: "var(--panel-2)",
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
            }}
            className="muted"
          >
            Host is the speaker in this room
          </div>
        )}

        {/* now playing */}
        <div>
          <h3 style={{ margin: "0 0 8px" }}>
            {nowPlaying ? nowPlaying.title : "Nothing playing"}
          </h3>
          <div className="muted">{nowPlaying?.artist}</div>
        </div>

        {/* listeners */}
        <div>
          <h4 style={{ margin: "0 0 10px" }}>Listening now ({listeners.length})</h4>
          <div style={{ display: "grid", gap: 8 }}>
            {listeners.length === 0 && <span className="muted">No one here yet.</span>}
            {listeners.map((l) => (
              <div key={l.user_id} className="row" style={{ gap: 8 }}>
                {l.avatar_url ? (
                  <img
                    src={l.avatar_url}
                    alt=""
                    width={28}
                    height={28}
                    style={{ borderRadius: "50%" }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--panel-2)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                    }}
                  >
                    {l.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span>
                  {l.display_name}
                  {l.user_id === hostId && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {" "}
                      · host
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
