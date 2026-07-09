-- mushe — admin dashboard: is_admin flag, admin-only RLS, room deletion RPC.
-- Depends on 0001_schema.sql + 0002_rls_and_rpcs.sql.

alter table public.profiles add column is_admin boolean not null default false;

-- =========================================================
-- Helper predicate (security definer to avoid recursive RLS)
-- =========================================================
create or replace function public.is_admin()
returns boolean language sql security definer stable
set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- =========================================================
-- Admin read access: see every room / member / queue row, not just their own.
-- =========================================================
create policy rooms_select_admin on public.rooms
  for select to authenticated using (is_admin());
create policy members_select_admin on public.room_members
  for select to authenticated using (is_admin());
create policy queue_select_admin on public.queue_items
  for select to authenticated using (is_admin());
create policy playback_select_admin on public.playback_state
  for select to authenticated using (is_admin());

-- =========================================================
-- RPC: admin_clear_room — delete a room as an admin (any room, not just own).
-- FK cascades handle room_members / queue_items / votes / playback_state.
-- =========================================================
create or replace function public.admin_clear_room(p_room uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not allowed';
  end if;
  delete from rooms where id = p_room;
end; $$;

-- =========================================================
-- Grant the admin account. Update the email below if it differs.
-- =========================================================
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'nguyenvanluong1511@gmail.com');
