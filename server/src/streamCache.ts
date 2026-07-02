// Audio cache + extraction pipeline.
//
// yt-dlp resolves the best audio stream for a YouTube video id and pipes it
// through ffmpeg, which remuxes/transcodes to a single normalized format
// (AAC in an .m4a container — natively playable in every major browser,
// including Safari, which is unreliable with webm/opus). ffmpeg writes to a
// cache file on disk; concurrent requests for the same video id attach to
// the same in-flight extraction instead of spawning duplicates.
//
// The route only serves a video once it is FULLY cached (see stream.ts) —
// serving progressively while ffmpeg was still writing let each client's
// <audio> element seek to a different byte offset depending on its own
// download progress, which is what caused followers joining mid-track to
// stall indefinitely (seeking into not-yet-written bytes of a fragmented,
// non-seekable mp4 stream). Waiting for the full file means every client
// gets a normal, fully-seekable file and starts from the same bytes.
//
// Audio bytes never flow through Lavalink — Lavalink (lavalink.ts) is only
// used for search/metadata resolution.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR = process.env.STREAM_CACHE_DIR ?? "./cache";
const YT_DLP_PATH = process.env.YT_DLP_PATH ?? "yt-dlp";
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "ffmpeg";
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.STREAM_MAX_CONCURRENT_DOWNLOADS ?? 3);
const CACHE_MAX_AGE_DAYS = Number(process.env.STREAM_CACHE_MAX_AGE_DAYS ?? 30);

const CONTENT_TYPE = "audio/mp4"; // AAC-in-m4a, output of the ffmpeg normalize step

const YT_ID_RE = /^[\w-]{11}$/;

interface CacheEntry {
  /** Final file size once extraction completes. */
  writtenBytes: number;
  /** Resolved once the file is fully written (success) or rejects (failure). */
  done: Promise<void>;
  complete: boolean;
}

const inFlight = new Map<string, CacheEntry>();
let activeDownloads = 0;
const downloadQueue: Array<() => void> = [];

function partPath(videoId: string): string {
  return join(CACHE_DIR, `${videoId}.part.m4a`);
}

function finalPath(videoId: string): string {
  return join(CACHE_DIR, `${videoId}.m4a`);
}

async function acquireSlot(): Promise<() => void> {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads++;
    return () => {
      activeDownloads--;
      const next = downloadQueue.shift();
      if (next) next();
    };
  }
  await new Promise<void>((resolve) => downloadQueue.push(resolve));
  activeDownloads++;
  return () => {
    activeDownloads--;
    const next = downloadQueue.shift();
    if (next) next();
  };
}

class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly kind: "unavailable" | "transient",
  ) {
    super(message);
  }
}

function classifyYtDlpError(stderr: string): ExtractionError {
  const s = stderr.toLowerCase();
  if (
    s.includes("video unavailable") ||
    s.includes("private video") ||
    s.includes("this video is not available") ||
    s.includes("sign in to confirm your age") ||
    s.includes("age-restricted") ||
    s.includes("not available in your country")
  ) {
    return new ExtractionError(stderr.trim().slice(-500), "unavailable");
  }
  return new ExtractionError(stderr.trim().slice(-500), "transient");
}

function startExtraction(videoId: string, entry: CacheEntry): void {
  const part = partPath(videoId);
  const final = finalPath(videoId);
  let stderr = "";

  // yt-dlp: pick the best audio-only stream, pipe raw bytes to stdout.
  const ytdlp = spawn(
    YT_DLP_PATH,
    [
      "-f",
      "bestaudio/best",
      "-o",
      "-",
      "--no-playlist",
      "--quiet",
      "--no-warnings",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  // ffmpeg: normalize whatever container/codec yt-dlp yields to AAC/m4a and
  // write straight to the part file. faststart (moov atom moved to the
  // front) requires ffmpeg to seek on its output, which isn't possible on a
  // pipe — so ffmpeg writes the file itself rather than us piping its stdout.
  const ffmpeg = spawn(
    FFMPEG_PATH,
    [
      "-i",
      "pipe:0",
      "-vn",
      "-acodec",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "faststart",
      "-f",
      "mp4",
      "-y",
      part,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  ffmpeg.stderr.on("data", () => {
    // ffmpeg logs progress/diagnostics to stderr; not needed unless debugging.
  });

  entry.done = new Promise<void>((resolve, reject) => {
    let ytdlpExitCode: number | null = null;
    let settled = false;

    const cleanupFailed = () => {
      rm(part, { force: true }).catch(() => {});
    };

    const maybeFail = () => {
      if (settled) return;
      if (ytdlpExitCode !== null && ytdlpExitCode !== 0) {
        settled = true;
        cleanupFailed();
        reject(classifyYtDlpError(stderr));
      }
    };

    ytdlp.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanupFailed();
      reject(new ExtractionError(`failed to spawn yt-dlp: ${err.message}`, "transient"));
    });
    ffmpeg.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanupFailed();
      reject(new ExtractionError(`failed to spawn ffmpeg: ${err.message}`, "transient"));
    });

    ytdlp.on("close", (code) => {
      ytdlpExitCode = code;
      maybeFail();
    });

    ffmpeg.on("close", async (code) => {
      if (settled) return;
      if (code !== 0) {
        settled = true;
        cleanupFailed();
        reject(new ExtractionError(`ffmpeg exited with code ${code}`, "transient"));
        return;
      }
      if (ytdlpExitCode !== null && ytdlpExitCode !== 0) return; // maybeFail already handled it
      settled = true;
      try {
        const stats = await stat(part);
        entry.writtenBytes = stats.size;
        await rename(part, final);
        entry.complete = true;
        resolve();
      } catch (err) {
        reject(err as Error);
      }
    });
  });
}

/**
 * Ensure `videoId` is fully extracted and cached to disk, then return its
 * path. Resolves only once the whole file is written — every client always
 * gets a complete, fully-seekable file starting from the same bytes.
 */
export async function ensureCached(videoId: string): Promise<{ path: string; size: number }> {
  if (!YT_ID_RE.test(videoId)) {
    throw new ExtractionError("invalid video id", "unavailable");
  }

  await mkdir(CACHE_DIR, { recursive: true });

  const final = finalPath(videoId);
  if (!inFlight.has(videoId) && existsSync(final)) {
    const stats = await stat(final);
    const now = new Date();
    utimes(final, now, now).catch(() => {});
    return { path: final, size: stats.size };
  }

  let entry = inFlight.get(videoId);
  if (!entry) {
    const newEntry: CacheEntry = { writtenBytes: 0, done: Promise.resolve(), complete: false };
    entry = newEntry;
    inFlight.set(videoId, newEntry);

    const release = await acquireSlot();
    startExtraction(videoId, newEntry);
    newEntry.done
      .catch(() => {})
      .finally(() => {
        release();
        // Keep the entry around briefly so late attachers still see the
        // final state, then drop it so future plays re-check the cache dir.
        setTimeout(() => {
          if (inFlight.get(videoId) === newEntry) inFlight.delete(videoId);
        }, 5_000);
      });
  }

  await entry.done;
  return { path: final, size: entry.writtenBytes };
}

export { CONTENT_TYPE, ExtractionError };

/** Delete cached files not accessed within STREAM_CACHE_MAX_AGE_DAYS. */
export async function sweepCache(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cutoff = Date.now() - CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files = await readdir(CACHE_DIR).catch(() => []);
  for (const name of files) {
    if (!name.endsWith(".m4a") || name.includes(".part.")) continue;
    const full = join(CACHE_DIR, name);
    try {
      const stats = await stat(full);
      if (stats.atimeMs < cutoff) await rm(full, { force: true });
    } catch {
      // ignore races with concurrent writers/evictions
    }
  }
}

export function startCacheSweeper(intervalMs = 6 * 60 * 60 * 1000): void {
  sweepCache().catch(() => {});
  setInterval(() => sweepCache().catch(() => {}), intervalMs).unref();
}
