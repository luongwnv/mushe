// GET /stream/:videoId — proxies normalized, fully-cached audio bytes to the
// browser with Range support. Waits for the full extraction to finish before
// responding (see streamCache.ts for why: partial/progressive files aren't
// reliably seekable and caused followers joining mid-track to stall).

import { createReadStream } from "node:fs";
import type { Context } from "hono";
import { CONTENT_TYPE, ExtractionError, ensureCached } from "./streamCache.js";

export async function handleStream(c: Context): Promise<Response> {
  const videoId = c.req.param("videoId");
  if (!videoId) return c.json({ error: "missing videoId" }, 400);

  let cached: { path: string; size: number };
  try {
    cached = await ensureCached(videoId);
  } catch (err) {
    if (err instanceof ExtractionError && err.kind === "unavailable") {
      return c.json({ error: "video unavailable" }, 422);
    }
    return c.json({ error: "failed to extract audio" }, 502);
  }

  const range = c.req.header("Range");
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPE,
    "Cache-Control": "public, max-age=86400",
    "Accept-Ranges": "bytes",
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : cached.size - 1;
      if (start <= end && end < cached.size) {
        headers["Content-Range"] = `bytes ${start}-${end}/${cached.size}`;
        headers["Content-Length"] = String(end - start + 1);
        return new Response(nodeReadableToWeb(createReadStream(cached.path, { start, end })), {
          status: 206,
          headers,
        });
      }
    }
    headers["Content-Range"] = `bytes */${cached.size}`;
    return new Response(null, { status: 416, headers });
  }

  headers["Content-Length"] = String(cached.size);
  return new Response(nodeReadableToWeb(createReadStream(cached.path)), { status: 200, headers });
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
