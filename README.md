# mushe

A collaborative music app — join a **room** with friends, **order** songs into a
shared queue, **upvote** to reorder it (democratic jukebox), and listen
**together** either synced on every device or through a single host's speaker.

> Hobby / MVP / private-use project. See **Limitations** below — this is not a
> licensed music service.

## How it works

- **Login:** Google via **Supabase Auth**.
- **Rooms:** create a room (you become host) → share the code → others join.
- **Queue + voting:** any member adds songs; upvotes reorder the queue
  (`vote_count DESC, added_at ASC`). The currently-playing song is locked.
- **Two playback modes** (host toggles):
  - **synced** — every browser plays the same track in sync (like Spotify Jam).
  - **host_only** — only the host's device plays; others control + queue.
- **Audio:** each browser plays via the **YouTube IFrame Player API** (audio
  streams directly from YouTube to each client — no audio bytes pass through our
  servers). The **host is the authoritative clock**; followers reconcile via a
  shared `playback_state` over Supabase Realtime.
- **Sources:** YouTube, and **Spotify without Premium** — we use the Spotify Web
  API for *metadata only* (free Client-Credentials flow) and resolve each
  Spotify track to a matching YouTube video for playback.

## Architecture

```
Browsers (YouTube IFrame player each; stream A/V directly from YouTube)
   │  Supabase Realtime room:{id}: Presence + Broadcast + Postgres Changes
   ▼
Supabase: Auth (Google), Postgres (rooms/members/queue/votes/playback_state/
          track_resolution), RLS, security-definer RPCs
   ▲
   │  metadata-only resolution calls
Node resolver (Hono): Spotify Web API + youtube-sr search + scoring
```

## Project layout

```
web/                 Vite + React + TypeScript SPA
server/              Node + Hono resolver service (Spotify→YouTube)
supabase/migrations/ SQL schema + RLS + RPCs
```

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. Run the migrations (Supabase CLI `supabase db reset`, or paste each file in
   the SQL editor in order): `supabase/migrations/0001_schema.sql`, then
   `0002_rls_and_rpcs.sql`.
3. **Auth → Providers → Google:** create a Google OAuth client (Google Cloud
   Console), set the redirect URI to
   `https://<project-ref>.supabase.co/auth/v1/callback`, paste the client
   id/secret, enable it.
4. **Auth → URL Configuration:** add `http://localhost:5173` (and your prod URL)
   to Site URL + Redirect URLs.

### 2. Resolver service (`server/`)
```bash
cd server
cp .env.example .env   # fill SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
npm install
npm run dev            # http://localhost:8787
```
Get Spotify credentials at developer.spotify.com → create an app
(Client-Credentials only; no redirect URI, no Premium needed).

### 3. Web app (`web/`)
```bash
cd web
cp .env.example .env   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # http://localhost:5173
```


## Limitations (read before using)

- **YouTube ToS:** the IFrame player must stay visible/unobscured; audio-only or
  hidden-player use is technically against YouTube's terms. Ads on non-Premium
  clients cause brief per-device desync (the drift loop self-heals within ~1s).
  Mobile background audio is unreliable.
- **Spotify→YouTube matching is heuristic** (duration/ISRC/channel scoring);
  rare tracks may mis-match — a manual "pick another" override is planned.
- **Not a licensed service.** Keep this private / non-commercial.
