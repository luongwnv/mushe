// Resolution pipeline: query/URL -> playable YouTube track(s).
//
//   - Spotify URL  -> Spotify metadata -> YouTube search (ISRC, artist-title) -> score
//   - YouTube URL  -> use the video id directly
//   - free text    -> YouTube search -> score
//
// Audio bytes never flow through this service. We only resolve metadata + ids.

import * as YouTubeSR from "youtube-sr";
import { getTrack, parseSpotifyTrackId, type SpotifyTrack } from "./spotify.js";

// youtube-sr's export interop varies across CJS/ESM builds: the class with
// .search() may sit at the namespace default, .default.default, or .YouTube.
// Resolve whichever shape actually exposes search().
interface YouTubeApi {
  search(query: string, opts?: { limit?: number; type?: string }): Promise<unknown[]>;
}
function resolveYouTube(): YouTubeApi {
  const candidates: unknown[] = [
    (YouTubeSR as { default?: unknown }).default,
    (YouTubeSR as { default?: { default?: unknown } }).default?.default,
    (YouTubeSR as { YouTube?: unknown }).YouTube,
    (YouTubeSR as { default?: { YouTube?: unknown } }).default?.YouTube,
    YouTubeSR,
  ];
  for (const c of candidates) {
    if (c && typeof (c as YouTubeApi).search === "function") return c as YouTubeApi;
  }
  throw new Error("youtube-sr: could not locate a search() function");
}
const YouTube = resolveYouTube();

export interface ResolvedTrack {
  source: "youtube" | "spotify";
  source_id: string; // final playable YouTube video id
  spotify_id: string | null;
  title: string;
  artist: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
}

const YT_URL_RE =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;

const NEGATIVE_TERMS = [
  "live",
  "cover",
  "remix",
  "sped up",
  "slowed",
  "8d",
  "nightcore",
  "reaction",
  "lyrics video",
  "karaoke",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(official.*?\)|\[official.*?\]/g, "")
    .replace(/feat\.?|ft\.?/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Candidate {
  id: string;
  title: string;
  channel: string | null;
  durationMs: number | null;
}

function toCandidate(v: {
  id?: string;
  title?: string;
  channel?: { name?: string } | null;
  duration?: number; // ms in youtube-sr
}): Candidate | null {
  if (!v.id || !v.title) return null;
  return {
    id: v.id,
    title: v.title,
    channel: v.channel?.name ?? null,
    durationMs: typeof v.duration === "number" && v.duration > 0 ? v.duration : null,
  };
}

/**
 * Score a YouTube candidate against the desired track. Higher is better.
 * Duration proximity is the strongest signal; official/"- Topic" channels and
 * title overlap boost; "live/cover/remix/..." penalize.
 */
function scoreCandidate(
  c: Candidate,
  want: { title: string; artist: string | null; durationMs: number | null },
): number {
  let score = 0;
  const titleNorm = normalize(c.title);
  const wantTitle = normalize(want.title);
  const wantArtist = want.artist ? normalize(want.artist) : "";

  // Duration proximity (±7s window).
  if (want.durationMs && c.durationMs) {
    const diff = Math.abs(c.durationMs - want.durationMs);
    if (diff <= 3000) score += 40;
    else if (diff <= 7000) score += 25;
    else if (diff <= 15000) score += 5;
    else score -= 30; // very different length => probably wrong version
  }

  // Channel trust.
  const channel = (c.channel ?? "").toLowerCase();
  if (channel.endsWith("- topic")) score += 25;
  if (channel.includes("vevo") || channel.includes("official")) score += 15;

  // Title / artist token overlap.
  for (const tok of wantTitle.split(" ")) {
    if (tok.length > 1 && titleNorm.includes(tok)) score += 3;
  }
  if (wantArtist) {
    for (const tok of wantArtist.split(" ")) {
      if (tok.length > 1 && titleNorm.includes(tok)) score += 3;
    }
  }

  // Penalize undesired variants unless they were requested.
  for (const neg of NEGATIVE_TERMS) {
    if (titleNorm.includes(neg) && !wantTitle.includes(neg)) score -= 12;
  }

  return score;
}

async function ytSearch(query: string, limit = 8): Promise<Candidate[]> {
  const results = await YouTube.search(query, { limit, type: "video" });
  return results
    .map((v) => toCandidate(v as Parameters<typeof toCandidate>[0]))
    .filter((c): c is Candidate => c !== null);
}

function candidateToTrack(
  c: Candidate,
  meta: { spotify: SpotifyTrack | null },
): ResolvedTrack {
  const sp = meta.spotify;
  return {
    source: sp ? "spotify" : "youtube",
    source_id: c.id,
    spotify_id: sp?.id ?? null,
    title: sp ? sp.title : c.title,
    artist: sp ? sp.artists.join(", ") : c.channel,
    duration_ms: sp?.durationMs ?? c.durationMs,
    thumbnail_url:
      sp?.thumbnailUrl ?? `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
  };
}

/** Resolve a Spotify track to ranked YouTube candidates. */
async function resolveSpotify(track: SpotifyTrack): Promise<ResolvedTrack[]> {
  const artist = track.artists[0] ?? "";
  const queries: string[] = [];
  if (track.isrc) queries.push(`"${track.isrc}"`);
  queries.push(`${artist} ${track.title}`);
  queries.push(`${artist} ${track.title} audio`);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const q of queries) {
    for (const c of await ytSearch(q)) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        candidates.push(c);
      }
    }
    // ISRC hit on a "- Topic" channel is good enough; stop early.
    if (track.isrc && candidates.some((c) => (c.channel ?? "").toLowerCase().endsWith("- topic"))) {
      break;
    }
  }

  return candidates
    .map((c) => ({
      track: candidateToTrack(c, { spotify: track }),
      score: scoreCandidate(c, {
        title: track.title,
        artist,
        durationMs: track.durationMs,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.track);
}

/** Resolve a free-text query to ranked YouTube candidates. */
async function resolveText(query: string): Promise<ResolvedTrack[]> {
  const candidates = await ytSearch(query);
  return candidates
    .map((c) => ({
      track: candidateToTrack(c, { spotify: null }),
      score: scoreCandidate(c, { title: query, artist: null, durationMs: null }),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.track);
}

/**
 * Top-level: given any query/URL, return ranked resolved tracks.
 * Order: Spotify URL > YouTube URL > free text.
 */
export async function search(query: string): Promise<ResolvedTrack[]> {
  const trimmed = query.trim();

  const spotifyId = parseSpotifyTrackId(trimmed);
  if (spotifyId) {
    const track = await getTrack(spotifyId);
    return resolveSpotify(track);
  }

  const ytMatch = trimmed.match(YT_URL_RE);
  if (ytMatch) {
    const id = ytMatch[1];
    // Pull a little metadata for display via a targeted search.
    const [first] = await ytSearch(id, 1);
    return [
      candidateToTrack(
        first ?? { id, title: trimmed, channel: null, durationMs: null },
        { spotify: null },
      ),
    ];
  }

  return resolveText(trimmed);
}

/** Resolve a single best track. */
export async function resolveOne(query: string): Promise<ResolvedTrack> {
  const results = await search(query);
  if (results.length === 0) {
    throw new Error(`No playable result for "${query}"`);
  }
  return results[0];
}
