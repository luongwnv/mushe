// Lavalink REST client — searches YouTube via the running Lavalink node
// (with the youtube-plugin, which avoids bot-detection / sig-function breakage
// that kills HTML scrapers like youtube-sr). We only need metadata + the
// YouTube video id (info.identifier) for the browser IFrame player.

const LAVALINK_URL = process.env.LAVALINK_URL ?? "http://localhost:2333";
const LAVALINK_PASSWORD = process.env.LAVALINK_PASSWORD ?? "youshallnotpass";

export interface LavalinkTrackInfo {
  identifier: string; // YouTube video id
  title: string;
  author: string;
  length: number; // ms
  uri: string;
  artworkUrl: string | null;
  isrc: string | null;
  sourceName: string;
}

interface LoadResult {
  loadType: "track" | "playlist" | "search" | "empty" | "error";
  data:
    | { info: LavalinkTrackInfo } // track
    | { info: LavalinkTrackInfo }[] // search
    | { tracks: { info: LavalinkTrackInfo }[] } // playlist
    | { message?: string }; // error
}

async function loadTracks(identifier: string): Promise<LavalinkTrackInfo[]> {
  const url = `${LAVALINK_URL}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`;
  const res = await fetch(url, {
    headers: { authorization: LAVALINK_PASSWORD },
  });
  if (!res.ok) {
    throw new Error(`Lavalink loadtracks failed: ${res.status}`);
  }
  const json = (await res.json()) as LoadResult;

  switch (json.loadType) {
    case "track":
      return [(json.data as { info: LavalinkTrackInfo }).info];
    case "search":
      return (json.data as { info: LavalinkTrackInfo }[]).map((t) => t.info);
    case "playlist":
      return (json.data as { tracks: { info: LavalinkTrackInfo }[] }).tracks.map((t) => t.info);
    case "empty":
      return [];
    case "error": {
      const msg = (json.data as { message?: string }).message ?? "unknown";
      throw new Error(`Lavalink error: ${msg}`);
    }
    default:
      return [];
  }
}

/** Search YouTube via Lavalink (ytsearch:). Returns up to `limit` tracks. */
export async function searchYouTube(query: string, limit = 8): Promise<LavalinkTrackInfo[]> {
  const results = await loadTracks(`ytsearch:${query}`);
  return results.slice(0, limit);
}

/** Load a direct YouTube URL/id (uses Lavalink to fetch metadata). */
export async function loadYouTubeUrl(urlOrId: string): Promise<LavalinkTrackInfo | null> {
  const results = await loadTracks(urlOrId);
  return results[0] ?? null;
}
