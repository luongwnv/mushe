-- mushe — schema: tables, indexes, triggers.
-- Run with the Supabase CLI (`supabase db reset`) or paste into the SQL editor.

-- =========================================================
-- profiles : 1:1 with auth.users, created on first login
-- =========================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- =========================================================
-- rooms
-- =========================================================
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null default 'Untitled Room',
  host_id       uuid not null references public.profiles(id) on delete cascade,
  playback_mode text not null default 'synced'
                  check (playback_mode in ('synced','host_only')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index rooms_code_idx on public.rooms (code);

-- =========================================================
-- room_members : durable membership + roster
-- =========================================================
create table public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('host','member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on public.room_members (user_id);

-- =========================================================
-- queue_items : songs ordered into a room
-- =========================================================
create table public.queue_items (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  added_by      uuid references public.profiles(id) on delete set null,
  source        text not null check (source in ('youtube','spotify')),
  source_id     text not null,                 -- final playable YouTube video id
  spotify_id    text,                          -- original Spotify track id, if any
  title         text not null,
  artist        text,
  duration_ms   integer,
  thumbnail_url text,
  vote_count    integer not null default 0,    -- denormalized cache (kept by trigger)
  status        text not null default 'queued'
                  check (status in ('queued','playing','played','skipped')),
  added_at      timestamptz not null default now(),
  played_at     timestamptz
);
create index queue_items_room_status_idx on public.queue_items (room_id, status);
-- the "what plays next" ordering index (only over queued rows)
create index queue_items_order_idx
  on public.queue_items (room_id, vote_count desc, added_at asc)
  where status = 'queued';
-- at most one playing track per room
create unique index queue_items_one_playing_idx
  on public.queue_items (room_id)
  where status = 'playing';

-- =========================================================
-- votes : one row = one user's upvote of one queue item
-- =========================================================
create table public.votes (
  queue_item_id uuid not null references public.queue_items(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (queue_item_id, user_id)         -- one vote per song per user
);
create index votes_room_idx on public.votes (room_id);

-- =========================================================
-- playback_state : exactly one row per room (server-authoritative clock)
-- =========================================================
create table public.playback_state (
  room_id         uuid primary key references public.rooms(id) on delete cascade,
  current_item_id uuid references public.queue_items(id) on delete set null,
  is_playing      boolean not null default false,
  position_ms     integer not null default 0,  -- position at the started_at anchor
  started_at      timestamptz,                 -- server-time anchor for the current play span
  updated_at      timestamptz not null default now()
);

-- =========================================================
-- track_resolution : cache of spotify_id -> youtube video id
-- =========================================================
create table public.track_resolution (
  spotify_id       text primary key,
  youtube_video_id text not null,
  title            text,
  artist           text,
  duration_ms      integer,
  thumbnail_url    text,
  resolved_at      timestamptz not null default now()
);

-- =========================================================
-- Trigger: create a profile row on first login (from Google metadata)
-- =========================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'listener'), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- Trigger: keep queue_items.vote_count in sync with votes
-- =========================================================
create or replace function public.sync_vote_count()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if (TG_OP = 'INSERT') then
    update public.queue_items
      set vote_count = vote_count + 1 where id = new.queue_item_id;
  elsif (TG_OP = 'DELETE') then
    update public.queue_items
      set vote_count = vote_count - 1 where id = old.queue_item_id;
  end if;
  return null;
end; $$;

create trigger trg_sync_vote_count
  after insert or delete on public.votes
  for each row execute function public.sync_vote_count();

-- =========================================================
-- Trigger: stamp votes.room_id from the parent item (don't trust the client)
-- =========================================================
create or replace function public.set_vote_room_id()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  select room_id into new.room_id
    from public.queue_items where id = new.queue_item_id;
  return new;
end; $$;

create trigger trg_set_vote_room_id
  before insert on public.votes
  for each row execute function public.set_vote_room_id();

-- =========================================================
-- Realtime: broadcast queue + playback changes to subscribers
-- =========================================================
alter publication supabase_realtime add table public.queue_items;
alter publication supabase_realtime add table public.playback_state;
