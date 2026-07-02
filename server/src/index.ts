import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";

// Load .env into process.env (Node >= 20.12). Must run before importing modules
// that read process.env at load time. Safe no-op if the file is missing.
try {
  (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile?.();
} catch {
  // no .env file — rely on real environment variables
}

const { search, resolveOne } = await import("./resolution.js");
const { handleStream } = await import("./stream.js");
const { startCacheSweeper } = await import("./streamCache.js");

const app = new Hono();

const corsEnv = (process.env.CORS_ORIGIN ?? "http://localhost:5173").trim();
const allowList = corsEnv === "*" ? null : corsEnv.split(",").map((s) => s.trim());

// Explicit CORS middleware — set Access-Control-Allow-Origin on every response
// (we send no credentials, so reflecting the origin / "*" is correct). This is
// version-independent and guarantees the header on GET, POST, and preflight.
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "*";
  const allowed = allowList === null ? origin : allowList.includes(origin) ? origin : allowList[0];
  c.header("Access-Control-Allow-Origin", allowed);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Range");
  c.header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  c.header("Access-Control-Max-Age", "86400");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

const QuerySchema = z.object({ query: z.string().min(1).max(500) });

// Server clock for the NTP-style sync handshake.
app.get("/now", (c) => c.json({ now: Date.now() }));

app.get("/health", (c) => c.json({ ok: true }));

// Ranked resolved candidates for a query/URL.
app.post("/search", async (c) => {
  const parsed = QuerySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid query" }, 400);
  try {
    return c.json(await search(parsed.data.query));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

// Single best resolved track for a query/URL.
app.post("/resolve", async (c) => {
  const parsed = QuerySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid query" }, 400);
  try {
    return c.json(await resolveOne(parsed.data.query));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

// Proxies normalized audio bytes for a YouTube video id (yt-dlp + ffmpeg,
// cached to disk). This is the only route that touches audio bytes.
app.get("/stream/:videoId", handleStream);

startCacheSweeper();

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`mushe resolver listening on http://localhost:${port}`);
