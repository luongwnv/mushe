// Clock synchronization + drift-correction helpers for synced playback.
//
// Browsers' Date.now() are not aligned with the server. We estimate a
// `serverTimeOffset` once on join (NTP-style), then express the shared
// playback position in *server time* so every client computes the same
// "where should I be right now" value.

import { env } from "./env";

let serverTimeOffset = 0; // serverNow = Date.now() + serverTimeOffset
let synced = false;

interface NowResponse {
  now: number; // server epoch ms
}

/**
 * NTP-style handshake against the resolver's /now endpoint. Takes several
 * samples and keeps the one with the smallest round-trip time (least jitter).
 * Safe to call repeatedly; later calls refine the offset.
 */
export async function syncClock(samples = 5): Promise<number> {
  let bestRtt = Infinity;
  let bestOffset = serverTimeOffset;

  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${env.resolverUrl}/now`, { cache: "no-store" });
      if (!res.ok) continue;
      const { now } = (await res.json()) as NowResponse;
      const t1 = Date.now();
      const rtt = t1 - t0;
      // Assume symmetric latency: server time at t1 ≈ now + rtt/2.
      const offset = now + rtt / 2 - t1;
      if (rtt < bestRtt) {
        bestRtt = rtt;
        bestOffset = offset;
      }
    } catch {
      // network blip — ignore this sample
    }
  }

  serverTimeOffset = bestOffset;
  synced = true;
  return serverTimeOffset;
}

/** Current server time in epoch ms (best estimate). */
export function serverNow(): number {
  return Date.now() + serverTimeOffset;
}

export function isClockSynced(): boolean {
  return synced;
}

/** Current server time as an ISO string — for writing playback anchors. */
export function serverNowIso(): string {
  return new Date(serverNow()).toISOString();
}

/** Parse a server-time ISO anchor (from playback_state.started_at) to epoch ms. */
export function isoToServerMs(iso: string | null): number | null {
  return iso ? new Date(iso).getTime() : null;
}

export interface PlaybackClock {
  isPlaying: boolean;
  positionMs: number;
  startedAtServerMs: number | null; // server epoch ms anchor
}

/**
 * The target position (ms into the track) the local player should be at right
 * now, given the shared playback clock.
 */
export function expectedPositionMs(clock: PlaybackClock): number {
  if (!clock.isPlaying || clock.startedAtServerMs == null) {
    return clock.positionMs;
  }
  return clock.positionMs + (serverNow() - clock.startedAtServerMs);
}

// Drift thresholds (ms).
export const HARD_DRIFT_MS = 1500; // seek
export const SOFT_DRIFT_MS = 250; // playbackRate nudge

export type DriftAction =
  | { kind: "none" }
  | { kind: "hard"; targetMs: number }
  | { kind: "soft"; rate: number };

/**
 * Decide how to correct local drift. `localMs` is the player's current time.
 * Returns a hard seek for large gaps, an inaudible playbackRate nudge for
 * small ones, otherwise no action.
 */
export function driftCorrection(expectedMs: number, localMs: number): DriftAction {
  const drift = expectedMs - localMs;
  const abs = Math.abs(drift);
  if (abs > HARD_DRIFT_MS) return { kind: "hard", targetMs: expectedMs };
  if (abs > SOFT_DRIFT_MS) return { kind: "soft", rate: drift > 0 ? 1.03 : 0.97 };
  return { kind: "none" };
}
