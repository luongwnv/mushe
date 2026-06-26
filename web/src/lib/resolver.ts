// Client for the Node resolution service. Turns a user query or a Spotify /
// YouTube URL into a playable resolved track (final YouTube video id).

import { env } from "./env";
import type { ResolvedTrack } from "./types";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.resolverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resolver ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

/** Free-text or URL search → ranked list of resolved candidates. */
export function searchTracks(query: string): Promise<ResolvedTrack[]> {
  return postJson<ResolvedTrack[]>("/search", { query });
}

/**
 * Resolve a single query/URL to the single best playable track.
 * Used by "add to queue" when the user picks or pastes a link.
 */
export function resolveTrack(query: string): Promise<ResolvedTrack> {
  return postJson<ResolvedTrack>("/resolve", { query });
}
