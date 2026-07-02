// Audio cache + progressive extraction pipeline.
//
// yt-dlp resolves the best audio stream for a YouTube video id and pipes it
// through ffmpeg, which remuxes/transcodes to a single normalized format
// (AAC in an .m4a container — natively playable in every major browser,
// including Safari, which is unreliable with webm/opus). ffmpeg writes to a
// cache file on disk; concurrent requests for the same video id attach to
// the same in-flight write and are served progressively as bytes land,
// rather than waiting for the full download to finish.
//
// Audio bytes never flow through Lavalink — Lavalink (lavalink.ts) is only
// used for search/metadata resolution.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
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
  /** Bytes written to the partial/final file so far. Grows as ffmpeg writes. */
  writtenBytes: number;
  /** Resolved once the file is fully written (success) or rejects (failure). */
  done: Promise<void>;
  /** True once `done` has settled successfully. */
  complete: boolean;
  waiters: Array<(n: number) => void>;
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

  // ffmpeg: normalize whatever container/codec yt-dlp yields to AAC/m4a,
  // faststart so the moov atom is at the front (needed for progressive
  // playback / seeking before the whole file is written).
  const ffmpeg: ChildProcessWithoutNullStreams = spawn(
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
      "frag_keyframe+empty_moov+faststart",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  ffmpeg.stderr.on("data", () => {
    // ffmpeg logs progress/diagnostics to stderr; not needed unless debugging.
  });

  entry.done = new Promise<void>((resolve, reject) => {
    const fsWrite = createWriteStream(part);
    ffmpeg.stdout.pipe(fsWrite);

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      entry.writtenBytes += chunk.length;
      const waiters = entry.waiters;
      entry.waiters = [];
      for (const w of waiters) w(entry.writtenBytes);
    });

    let ytdlpExitCode: number | null = null;
    let ffmpegExitCode: number | null = null;
    let settled = false;

    const maybeFail = () => {
      if (settled) return;
      if (ytdlpExitCode !== null && ytdlpExitCode !== 0) {
        settled = true;
        fsWrite.destroy();
        rm(part, { force: true }).catch(() => {});
        reject(classifyYtDlpError(stderr));
      }
    };

    ytdlp.on("error", (err) => {
      if (settled) return;
      settled = true;
      fsWrite.destroy();
      rm(part, { force: true }).catch(() => {});
      reject(new ExtractionError(`failed to spawn yt-dlp: ${err.message}`, "transient"));
    });
    ffmpeg.on("error", (err) => {
      if (settled) return;
      settled = true;
      fsWrite.destroy();
      rm(part, { force: true }).catch(() => {});
      reject(new ExtractionError(`failed to spawn ffmpeg: ${err.message}`, "transient"));
    });

    ytdlp.on("close", (code) => {
      ytdlpExitCode = code;
      maybeFail();
    });

    ffmpeg.on("close", (code) => {
      ffmpegExitCode = code;
      if (settled) return;
      if (code !== 0 && (ytdlpExitCode === null || ytdlpExitCode === 0)) {
        settled = true;
        fsWrite.destroy();
        rm(part, { force: true }).catch(() => {});
        reject(new ExtractionError(`ffmpeg exited with code ${code}`, "transient"));
        return;
      }
    });

    fsWrite.on("finish", async () => {
      if (settled) return;
      // ffmpeg's stdout ending (which triggers this) always precedes or
      // coincides with its "close" event; a nonzero ffmpegExitCode will
      // have already been observed here if ffmpeg failed. `null` means
      // ffmpeg's stdout closed cleanly before the process "close" event
      // was delivered — treat as success (data is what matters).
      if (ffmpegExitCode !== null && ffmpegExitCode !== 0) return; // close handler will reject
      settled = true;
      try {
        await rename(part, final);
        entry.complete = true;
        const waiters = entry.waiters;
        entry.waiters = [];
        for (const w of waiters) w(entry.writtenBytes);
        resolve();
      } catch (err) {
        reject(err as Error);
      }
    });

    fsWrite.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Ensure extraction has started for `videoId` and return a handle for
 * progressive reads: `waitForBytes(n)` resolves once at least n bytes have
 * been written (or the file is complete/failed), and `path`/`isComplete()`
 * let the caller build a Range-aware response.
 */
export async function ensureStreaming(videoId: string): Promise<{
  path: string;
  isComplete: () => boolean;
  currentSize: () => number;
  waitForBytes: (n: number) => Promise<number>;
  awaitDone: () => Promise<void>;
}> {
  if (!YT_ID_RE.test(videoId)) {
    throw new ExtractionError("invalid video id", "unavailable");
  }

  await mkdir(CACHE_DIR, { recursive: true });

  const final = finalPath(videoId);
  if (!inFlight.has(videoId) && existsSync(final)) {
    const stats = await stat(final);
    const now = new Date();
    utimes(final, now, now).catch(() => {});
    return {
      path: final,
      isComplete: () => true,
      currentSize: () => stats.size,
      waitForBytes: async () => stats.size,
      awaitDone: async () => {},
    };
  }

  let entry = inFlight.get(videoId);
  if (!entry) {
    entry = { writtenBytes: 0, done: Promise.resolve(), complete: false, waiters: [] };
    inFlight.set(videoId, entry);

    const release = await acquireSlot();
    startExtraction(videoId, entry);
    entry.done
      .catch(() => {})
      .finally(() => {
        release();
        // Keep the entry around briefly so late attachers still see the
        // final state, then drop it so future plays re-check the cache dir.
        setTimeout(() => {
          if (inFlight.get(videoId) === entry) inFlight.delete(videoId);
        }, 5_000);
      });
  }

  const capturedEntry = entry;
  return {
    path: capturedEntry.complete ? final : partPath(videoId),
    isComplete: () => capturedEntry.complete,
    currentSize: () => capturedEntry.writtenBytes,
    waitForBytes: (n: number) =>
      new Promise<number>((resolve, reject) => {
        if (capturedEntry.writtenBytes >= n || capturedEntry.complete) {
          resolve(capturedEntry.writtenBytes);
          return;
        }
        capturedEntry.waiters.push(resolve);
        capturedEntry.done.catch(reject);
      }),
    awaitDone: () => capturedEntry.done,
  };
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
