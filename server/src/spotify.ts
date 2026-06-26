// Spotify Web API client — Client Credentials flow (app-level token).
// Metadata only: this never touches the Web Playback SDK, so no user login
// and no Premium are required. We read title/artist/duration/ISRC.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;

function creds(): { id: string; secret: string } {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set (see server/.env.example)",
    );
  }
  return { id, secret };
}

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }
  const { id, secret } = creds();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cached.token;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artists: string[];
  durationMs: number;
  isrc: string | null;
  thumbnailUrl: string | null;
}

/** Extract a Spotify track id from an open.spotify.com URL or spotify:track: URI. */
export function parseSpotifyTrackId(input: string): string | null {
  const url = input.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (url) return url[1];
  const uri = input.match(/spotify:track:([a-zA-Z0-9]+)/);
  if (uri) return uri[1];
  return null;
}

export async function getTrack(trackId: string): Promise<SpotifyTrack> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/tracks/${trackId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify track fetch failed: ${res.status}`);
  }
  const t = (await res.json()) as {
    id: string;
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { images: { url: string }[] };
    external_ids?: { isrc?: string };
  };
  return {
    id: t.id,
    title: t.name,
    artists: t.artists.map((a) => a.name),
    durationMs: t.duration_ms,
    isrc: t.external_ids?.isrc ?? null,
    thumbnailUrl: t.album.images[0]?.url ?? null,
  };
}
