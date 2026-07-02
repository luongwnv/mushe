// GET /stream/:videoId — proxies normalized audio bytes to the browser.
//
// Serves progressively: while ffmpeg is still writing the cache file for a
// video that's being extracted for the first time, this route streams
// whatever bytes exist and keeps reading as more arrive (tail -f style),
// so playback starts almost immediately instead of waiting for the whole
// track to download. Once cached, subsequent requests (any room member,
// any later replay) are served straight from disk with full Range support.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Context } from "hono";
import { CONTENT_TYPE, ExtractionError, ensureStreaming } from "./streamCache.js";

const POLL_MS = 100;

export async function handleStream(c: Context): Promise<Response> {
  const videoId = c.req.param("videoId");
  if (!videoId) return c.json({ error: "missing videoId" }, 400);

  let handle: Awaited<ReturnType<typeof ensureStreaming>>;
  try {
    handle = await ensureStreaming(videoId);
  } catch (err) {
    if (err instanceof ExtractionError && err.kind === "unavailable") {
      return c.json({ error: "video unavailable" }, 422);
    }
    return c.json({ error: "failed to start stream" }, 502);
  }

  // If the file is already fully cached, serve it as a normal static file
  // with Range support (seeking anywhere works once it's complete).
  if (handle.isComplete()) {
    const stats = await stat(handle.path);
    return serveRange(c, handle.path, stats.size, true);
  }

  // Still being written: stream what's available and keep following the
  // file as ffmpeg appends to it. Range requests are not honored on the
  // in-progress path (browser gets a plain 200 sequential stream); once
  // fully cached, later requests (including this same client re-fetching
  // after a seek) get full Range support via the branch above.
  const nodeStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let offset = 0;
      let cancelled = false;
      c.req.raw.signal.addEventListener("abort", () => {
        cancelled = true;
      });

      while (!cancelled) {
        const available = handle.currentSize();
        if (available > offset) {
          const chunk = await readRange(handle.path, offset, available - 1);
          controller.enqueue(chunk);
          offset = available;
          continue;
        }
        if (handle.isComplete()) break;
        try {
          await Promise.race([
            handle.waitForBytes(offset + 1),
            new Promise((resolve) => setTimeout(resolve, POLL_MS)),
          ]);
        } catch {
          break; // extraction failed after we started streaming
        }
      }
      controller.close();
    },
  });

  return new Response(nodeStream, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

async function readRange(path: string, start: number, end: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const rs = createReadStream(path, { start, end });
    rs.on("data", (d) => chunks.push(d as Buffer));
    rs.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    rs.on("error", reject);
  });
}

function serveRange(c: Context, path: string, size: number, acceptRanges: boolean): Response {
  const range = c.req.header("Range");
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPE,
    "Cache-Control": "public, max-age=86400",
  };
  if (acceptRanges) headers["Accept-Ranges"] = "bytes";

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : size - 1;
      if (start <= end && end < size) {
        const stream = createReadStream(path, { start, end });
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        headers["Content-Length"] = String(end - start + 1);
        return new Response(nodeReadableToWeb(stream), { status: 206, headers });
      }
    }
    headers["Content-Range"] = `bytes */${size}`;
    return new Response(null, { status: 416, headers });
  }

  headers["Content-Length"] = String(size);
  const stream = createReadStream(path);
  return new Response(nodeReadableToWeb(stream), { status: 200, headers });
}

function nodeReadableToWeb(rs: ReturnType<typeof createReadStream>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      rs.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      rs.on("end", () => controller.close());
      rs.on("error", (err) => controller.error(err));
    },
    cancel() {
      rs.destroy();
    },
  });
}
