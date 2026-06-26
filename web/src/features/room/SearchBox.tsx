import { useState } from "react";
import { searchTracks } from "../../lib/resolver";
import type { ResolvedTrack } from "../../lib/types";
import { formatDuration } from "./format";

interface Props {
  onAdd: (track: ResolvedTrack) => void;
  adding: boolean;
}

// Search the resolver service (YouTube + Spotify-link resolution) and let the
// user pick a result to add to the room's queue.
export default function SearchBox({ onAdd, adding }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResolvedTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  async function run() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchTracks(q));
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function add(track: ResolvedTrack) {
    onAdd(track);
    setAddedIds((prev) => new Set(prev).add(track.source_id));
  }

  return (
    <div>
      <div className="row">
        <input
          placeholder="Search a song, or paste a YouTube / Spotify link"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
          style={{ flex: 1 }}
        />
        <button onClick={() => void run()} disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}

      {results.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          {results.map((t) => {
            const added = addedIds.has(t.source_id);
            return (
              <div
                key={t.source_id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  background: "var(--panel-2)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <div className="row" style={{ gap: 10, minWidth: 0 }}>
                  {t.thumbnail_url && (
                    <img
                      src={t.thumbnail_url}
                      alt=""
                      width={40}
                      height={40}
                      style={{ borderRadius: 4, objectFit: "cover" }}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.title}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {t.artist}
                      {t.duration_ms ? ` · ${formatDuration(t.duration_ms)}` : ""}
                      {t.source === "spotify" ? " · via Spotify" : ""}
                    </div>
                  </div>
                </div>
                <button onClick={() => add(t)} disabled={adding || added}>
                  {added ? "Added" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
