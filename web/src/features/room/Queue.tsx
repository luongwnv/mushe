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

// Spotify-style queue table: vote-ordered (highest first; ties: first added).
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
    <table className="qtable">
      <thead>
        <tr>
          <th className="idx">#</th>
          <th>Title</th>
          <th style={{ width: 110 }}>Votes</th>
          <th style={{ width: 64, textAlign: "right" }}>⏱</th>
          <th style={{ width: 40 }}></th>
        </tr>
      </thead>
      <tbody>
        {items.map((q, i) => {
          const voted = myVotes.has(q.id);
          const canRemove = isHost || q.added_by === myUserId;
          return (
            <tr key={q.id} className="qrow">
              <td className="idx">{i + 1}</td>
              <td>
                <div className="cell-track">
                  {q.thumbnail_url && (
                    <img className="thumb" src={q.thumbnail_url} alt="" width={40} height={40} />
                  )}
                  <div className="meta">
                    <div className="title">{q.title}</div>
                    <div className="muted ellipsis" style={{ fontSize: 13 }}>
                      {q.artist}
                      {q.added_by === myUserId ? " · added by you" : ""}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <button
                  className={voted ? "votebtn on" : "votebtn"}
                  onClick={() => onToggleVote(q.id, voted)}
                  title={voted ? "Remove your vote" : "Upvote"}
                >
                  ▲ {q.vote_count}
                </button>
              </td>
              <td className="muted" style={{ textAlign: "right" }}>
                {formatDuration(q.duration_ms)}
              </td>
              <td>
                {canRemove && (
                  <button className="iconbtn" onClick={() => onRemove(q.id)} title="Remove">
                    ✕
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
