import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { search, resolveOne } from "./resolution.js";

const app = new Hono();

const corsEnv = (process.env.CORS_ORIGIN ?? "http://localhost:5173").trim();
// "*" → reflect any origin; otherwise an exact-match allowlist (comma-separated).
const corsOrigin =
  corsEnv === "*"
    ? (origin: string) => origin || "*"
    : corsEnv.split(",").map((s) => s.trim());

app.use("*", cors({ origin: corsOrigin }));

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

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`mushe resolver listening on http://localhost:${port}`);
