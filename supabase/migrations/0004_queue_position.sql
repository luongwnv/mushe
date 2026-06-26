-- mushe — 0004: manual queue ordering via a position column.
-- Members can drag-reorder; advance_track still respects vote_count when
-- position is null (legacy rows), but once any item is reordered all items
-- in the room get a position stamp and the order index uses it.

alter table public.queue_items
  add column if not exists position integer;

-- Backfill: assign a stable initial position to existing queued rows
-- ordered by (vote_count desc, added_at asc) so the existing sort is preserved.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.queue_items
    where status = 'queued'
    order by vote_count desc, added_at asc
  loop
    update public.queue_items set position = n where id = r.id;
    n := n + 1;
  end loop;
end; $$;

-- Index for the new ordering column.
create index if not exists queue_items_position_idx
  on public.queue_items (room_id, position asc nulls last)
  where status = 'queued';

-- ============================================================
-- reorder_queue: atomically reassign positions for a room's
-- queued items given an ordered list of item ids.
-- ============================================================
create or replace function public.reorder_queue(p_room uuid, p_ids uuid[])
returns void language plpgsql security definer
set search_path = public as $$
declare
  i integer := 0;
  v_id uuid;
begin
  if not is_room_member(p_room) then
    raise exception 'not a room member';
  end if;

  -- Validate: every supplied id must belong to this room and be queued.
  if exists (
    select 1 from unnest(p_ids) t(id)
    where not exists (
      select 1 from public.queue_items
      where queue_items.id = t.id
        and queue_items.room_id = p_room
        and queue_items.status = 'queued'
    )
  ) then
    raise exception 'invalid item id in reorder list';
  end if;

  foreach v_id in array p_ids loop
    update public.queue_items set position = i where id = v_id;
    i := i + 1;
  end loop;
end; $$;

-- ============================================================
-- Update advance_track to prefer position ordering when set.
-- Re-create the whole function so it stays in sync.
-- ============================================================
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

  -- repeat one: restart the current track
  if v_state.repeat_mode = 'one' and v_state.current_item_id is not null then
    update playback_state set position_ms = 0, started_at = now(), is_playing = true, updated_at = now()
      where room_id = p_room;
    select * into v_cur from queue_items where id = v_state.current_item_id;
    return v_cur;
  end if;

  -- mark current played
  update queue_items set status = 'played', played_at = now()
    where room_id = p_room and status = 'playing';

  -- pick next: shuffle => random; position set => use position; else vote+FIFO
  if v_state.shuffle then
    select * into v_next from queue_items
      where room_id = p_room and status = 'queued'
      order by random() limit 1 for update skip locked;
  else
    select * into v_next from queue_items
      where room_id = p_room and status = 'queued'
      order by position asc nulls last, vote_count desc, added_at asc
      limit 1 for update skip locked;
  end if;

  -- repeat all + empty queue: requeue everything played this cycle
  if v_next.id is null and v_state.repeat_mode = 'all' then
    update queue_items set status = 'queued', played_at = null
      where room_id = p_room and status = 'played';
    select * into v_next from queue_items
      where room_id = p_room and status = 'queued'
      order by position asc nulls last, vote_count desc, added_at asc
      limit 1 for update skip locked;
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
