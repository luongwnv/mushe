-- mushe — Row Level Security policies + security-definer RPCs.
-- Depends on 0001_schema.sql.

-- =========================================================
-- Helper predicates (security definer to avoid recursive RLS)
-- =========================================================
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from room_members
    where room_id = p_room and user_id = auth.uid()
  );
$$;

create or replace function public.is_room_host(p_room uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from rooms
    where id = p_room and host_id = auth.uid()
  );
$$;

-- =========================================================
-- Enable RLS on all tables
-- =========================================================
alter table public.profiles        enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_members    enable row level security;
alter table public.queue_items     enable row level security;
alter table public.votes           enable row level security;
alter table public.playback_state  enable row level security;
alter table public.track_resolution enable row level security;

-- ---------- profiles ----------
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- rooms ----------
-- Members read their rooms. Joining-by-code goes through join_room() (definer).
create policy rooms_select_member on public.rooms
  for select to authenticated using (is_room_member(id));
create policy rooms_insert_self_host on public.rooms
  for insert to authenticated with check (host_id = auth.uid());
create policy rooms_update_host on public.rooms
  for update to authenticated using (is_room_host(id)) with check (is_room_host(id));
create policy rooms_delete_host on public.rooms
  for delete to authenticated using (is_room_host(id));

-- ---------- room_members ----------
create policy members_select on public.room_members
  for select to authenticated using (is_room_member(room_id));
create policy members_insert_self on public.room_members
  for insert to authenticated with check (user_id = auth.uid());
create policy members_delete_self_or_host on public.room_members
  for delete to authenticated
  using (user_id = auth.uid() or is_room_host(room_id));

-- ---------- queue_items ----------
-- Members read; members add their own. NO direct UPDATE (status/vote_count are
-- mutated only via triggers + the advance_track RPC). DELETE: host or own queued.
create policy queue_select on public.queue_items
  for select to authenticated using (is_room_member(room_id));
create policy queue_insert on public.queue_items
  for insert to authenticated
  with check (is_room_member(room_id) and added_by = auth.uid());
create policy queue_delete on public.queue_items
  for delete to authenticated
  using (is_room_host(room_id) or (added_by = auth.uid() and status = 'queued'));

-- ---------- votes ----------
create policy votes_select on public.votes
  for select to authenticated using (is_room_member(room_id));
create policy votes_insert_self on public.votes
  for insert to authenticated
  with check (user_id = auth.uid() and is_room_member(room_id));
create policy votes_delete_self on public.votes
  for delete to authenticated using (user_id = auth.uid());

-- ---------- playback_state ----------
-- Read: any member. Write: host only (single transport authority).
create policy playback_select on public.playback_state
  for select to authenticated using (is_room_member(room_id));
create policy playback_insert_host on public.playback_state
  for insert to authenticated with check (is_room_host(room_id));
create policy playback_update_host on public.playback_state
  for update to authenticated using (is_room_host(room_id)) with check (is_room_host(room_id));

-- ---------- track_resolution ----------
-- Read-only cache for authenticated clients; writes via service role (bypasses RLS).
create policy resolution_select on public.track_resolution
  for select to authenticated using (true);

-- =========================================================
-- RPC: create_room — room + host membership + empty playback_state
-- Returns the shareable code.
-- =========================================================
create or replace function public.create_room(p_name text)
returns text language plpgsql security definer
set search_path = public as $$
declare
  v_code text;
  v_room rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- short, unambiguous code (no 0/O/1/I); retry on rare collision
  loop
    v_code := upper(
      substr(translate(encode(gen_random_bytes(6), 'base64'),
             '+/=0O1Il', 'ABCDEFGH'), 1, 6)
    );
    begin
      insert into rooms (code, name, host_id)
      values (v_code, coalesce(nullif(trim(p_name), ''), 'Untitled Room'), auth.uid())
      returning * into v_room;
      exit;
    exception when unique_violation then
      -- code collided; loop and try again
    end;
  end loop;

  insert into room_members (room_id, user_id, role)
  values (v_room.id, auth.uid(), 'host');

  insert into playback_state (room_id) values (v_room.id);

  return v_room.code;
end; $$;

-- =========================================================
-- RPC: join_room — the only sanctioned join path (by code)
-- =========================================================
create or replace function public.join_room(p_code text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_room rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_room from rooms
    where code = upper(p_code) and is_active = true;
  if v_room.id is null then
    raise exception 'room not found';
  end if;

  insert into room_members (room_id, user_id, role)
  values (v_room.id, auth.uid(), 'member')
  on conflict (room_id, user_id) do nothing;

  return v_room.id;
end; $$;

-- =========================================================
-- RPC: cast_vote / retract_vote
-- =========================================================
create or replace function public.cast_vote(p_item uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_room uuid;
begin
  select room_id into v_room from queue_items where id = p_item;
  if v_room is null or not is_room_member(v_room) then
    raise exception 'not allowed';
  end if;
  insert into votes (queue_item_id, user_id, room_id)
  values (p_item, auth.uid(), v_room)
  on conflict do nothing;
end; $$;

create or replace function public.retract_vote(p_item uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  delete from votes where queue_item_id = p_item and user_id = auth.uid();
end; $$;

-- =========================================================
-- RPC: advance_track — atomic "play next" (host only, idempotent)
-- =========================================================
create or replace function public.advance_track(p_room uuid, p_expected_current uuid)
returns queue_items language plpgsql security definer
set search_path = public as $$
declare
  v_state playback_state;
  v_next  queue_items;
begin
  if not is_room_host(p_room) then
    raise exception 'only the host can advance playback';
  end if;

  -- lock the room's transport row to serialize concurrent advances
  select * into v_state from playback_state where room_id = p_room for update;

  -- idempotency: if the current item already differs from what the caller saw,
  -- a previous advance won — return the current playing item, do nothing.
  if v_state.current_item_id is distinct from p_expected_current then
    select * into v_next from queue_items
      where room_id = p_room and status = 'playing';
    return v_next;
  end if;

  -- mark the current item as played
  update queue_items set status = 'played', played_at = now()
    where room_id = p_room and status = 'playing';

  -- pick the highest-voted queued track (FIFO tiebreak)
  select * into v_next from queue_items
    where room_id = p_room and status = 'queued'
    order by vote_count desc, added_at asc
    limit 1
    for update skip locked;

  if v_next.id is not null then
    update queue_items set status = 'playing' where id = v_next.id;
    update playback_state set
      current_item_id = v_next.id,
      is_playing = true,
      position_ms = 0,
      started_at = now(),
      updated_at = now()
    where room_id = p_room;
  else
    update playback_state set
      current_item_id = null,
      is_playing = false,
      position_ms = 0,
      updated_at = now()
    where room_id = p_room;
  end if;

  return v_next;
end; $$;
