import type { QueueItem } from "../../lib/types";
import { formatDuration } from "./format";

interface Props {
  items: QueueItem[]; // queued items only, already sorted
  myVotes: Set<string>;
  myUserId: string;
  isHost: boolean;
  onToggleVote: (itemId: string, voted: boolean) => void;
  onRemove: (itemId: string) => void;
}

// The shared, vote-ordered queue. Highest-voted first (ties: first added).
export default function Queue({
  items,
  myVotes,
  myUserId,
  isHost,
  onToggleVote,
  onRemove,
}: Props) {
  if (items.length === 0) {
    return <p className="muted">Queue is empty — search above to add a song.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.map((q, i) => {
        const voted = myVotes.has(q.id);
        const canRemove = isHost || q.added_by === myUserId;
        return (
          <div
            key={q.id}
            className="row"
            style={{
              justifyContent: "space-between",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <span className="muted" style={{ width: 18, textAlign: "right" }}>
                {i + 1}
              </span>
              {q.thumbnail_url && (
                <img
                  src={q.thumbnail_url}
                  alt=""
                  width={40}
                  height={40}
                  style={{ borderRadius: 4, objectFit: "cover" }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {q.title}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {q.artist}
                  {q.duration_ms ? ` · ${formatDuration(q.duration_ms)}` : ""}
                </div>
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                className="secondary"
                onClick={() => onToggleVote(q.id, voted)}
                title={voted ? "Remove your vote" : "Upvote"}
                style={{
                  padding: "6px 12px",
                  background: voted ? "var(--accent)" : "var(--panel-2)",
                  color: voted ? "#0b0b0b" : "var(--text)",
                }}
              >
                ▲ {q.vote_count}
              </button>
              {canRemove && (
                <button
                  className="secondary"
                  onClick={() => onRemove(q.id)}
                  title="Remove"
                  style={{ padding: "6px 10px" }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
