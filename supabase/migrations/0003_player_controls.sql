-- mushe — 0003: richer player controls (repeat, shuffle, previous) and let any
-- room member drive playback (collaborative control, not host-only).

-- repeat mode + shuffle flag on the shared transport
alter table public.playback_state
  add column if not exists repeat_mode text not null default 'off'
    check (repeat_mode in ('off', 'one', 'all')),
  add column if not exists shuffle boolean not null default false;

-- ============================================================
-- Relax playback control to any room member (was host-only).
-- ============================================================
drop policy if exists playback_update_host on public.playback_state;
drop policy if exists playback_insert_host on public.playback_state;

create policy playback_update_member on public.playback_state
  for update to authenticated using (is_room_member(room_id)) with check (is_room_member(room_id));
create policy playback_insert_member on public.playback_state
  for insert to authenticated with check (is_room_member(room_id));

-- advance_track was host-checked; re-create it to allow any member, add repeat
-- ('one' replays current) and shuffle (random pick instead of top-voted).
create or replace function public.advance_track(p_room uuid, p_expected_current uuid)
returns queue_items language plpgsql security definer
set search_path = public as $$
declare
  v_state playback_state;
  v_next  queue_items;
  v_cur   queue_items;
begin
  if not is_room_member(p_room) then
    raise exception 'not a room member';
  end if;

  select * into v_state from playback_state where room_id = p_room for update;

  -- idempotency: someone else already advanced
  if v_state.current_item_id is distinct from p_expected_current then
    select * into v_next from queue_items where room_id = p_room and status = 'playing';
    return v_next;
  end if;

  -- repeat one: restart the current track, don't advance
  if v_state.repeat_mode = 'one' and v_state.current_item_id is not null then
    update playback_state set position_ms = 0, started_at = now(), is_playing = true, updated_at = now()
      where room_id = p_room;
    select * into v_cur from queue_items where id = v_state.current_item_id;
    return v_cur;
  end if;

  -- mark current played
  update queue_items set status = 'played', played_at = now()
    where room_id = p_room and status = 'playing';

  -- pick next: shuffle => random; else highest-voted (FIFO tiebreak)
  if v_state.shuffle then
    select * into v_next from queue_items
      where room_id = p_room and status = 'queued'
      order by random() limit 1 for update skip locked;
  else
    select * into v_next from queue_items
      where room_id = p_room and status = 'queued'
      order by vote_count desc, added_at asc limit 1 for update skip locked;
  end if;

  -- repeat all + empty queue: requeue everything that was played this cycle
  if v_next.id is null and v_state.repeat_mode = 'all' then
    update queue_items set status = 'queued', played_at = null
      where room_id = p_room and status = 'played';
    select * into v_next from queue_items
      where room_id = p_room and status = 'queued'
      order by vote_count desc, added_at asc limit 1 for update skip locked;
  end if;

  if v_next.id is not null then
    update queue_items set status = 'playing' where id = v_next.id;
    update playback_state set current_item_id = v_next.id, is_playing = true,
      position_ms = 0, started_at = now(), updated_at = now() where room_id = p_room;
  else
    update playback_state set current_item_id = null, is_playing = false,
      position_ms = 0, updated_at = now() where room_id = p_room;
  end if;

  return v_next;
end; $$;

-- ============================================================
-- previous_track: replay the most recently played track.
-- ============================================================
create or replace function public.previous_track(p_room uuid)
returns queue_items language plpgsql security definer
set search_path = public as $$
declare
  v_prev queue_items;
begin
  if not is_room_member(p_room) then
    raise exception 'not a room member';
  end if;

  select * into v_prev from queue_items
    where room_id = p_room and status = 'played'
    order by played_at desc nulls last limit 1 for update skip locked;
  if v_prev.id is null then
    -- nothing to go back to: just restart current
    update playback_state set position_ms = 0, started_at = now(), updated_at = now()
      where room_id = p_room;
    select * into v_prev from queue_items where room_id = p_room and status = 'playing';
    return v_prev;
  end if;

  -- send the current track back to the front of the queue
  update queue_items set status = 'queued' where room_id = p_room and status = 'playing';
  -- promote the previous track to playing
  update queue_items set status = 'playing', played_at = null where id = v_prev.id;
  update playback_state set current_item_id = v_prev.id, is_playing = true,
    position_ms = 0, started_at = now(), updated_at = now() where room_id = p_room;

  return v_prev;
end; $$;

-- ============================================================
-- set_repeat / set_shuffle: toggle transport modes (any member).
-- ============================================================
create or replace function public.set_repeat(p_room uuid, p_mode text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not is_room_member(p_room) then raise exception 'not a room member'; end if;
  if p_mode not in ('off','one','all') then raise exception 'bad repeat mode'; end if;
  update playback_state set repeat_mode = p_mode, updated_at = now() where room_id = p_room;
end; $$;

create or replace function public.set_shuffle(p_room uuid, p_on boolean)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not is_room_member(p_room) then raise exception 'not a room member'; end if;
  update playback_state set shuffle = p_on, updated_at = now() where room_id = p_room;
end; $$;
