-- Removing bowlers and queue sheets. Both are moved out of sight rather than
-- erased: anyone with the link can do it, so a mistake can be undone from the
-- "recently removed" lists. A removed bowler disappears from every list,
-- search and page; their specs, balls and photos are kept with them.

alter table public.customers add column removed_at timestamptz, add column removed_by text;
alter table public.intake_items add column removed_at timestamptz, add column removed_by text;

-- Only the functions below set or clear these marks.
create function private.keep_removed_marks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    new.removed_at := case when tg_op = 'INSERT' then null else old.removed_at end;
    new.removed_by := case when tg_op = 'INSERT' then null else old.removed_by end;
  end if;
  return new;
end;
$$;

create trigger customers_keep_removed_marks before insert or update on public.customers
  for each row execute function private.keep_removed_marks();
create trigger intake_items_keep_removed_marks before insert or update on public.intake_items
  for each row execute function private.keep_removed_marks();

alter policy "Members can view customers" on public.customers
  using (private.is_shop_member(shop_id) and removed_at is null);
alter policy "Members can view the intake queue" on public.intake_items
  using (private.is_shop_member(shop_id) and removed_at is null);

create function public.remove_customer(p_id uuid, p_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customers
     set removed_at = now(), removed_by = left(nullif(trim(p_name), ''), 120)
   where id = p_id and removed_at is null and private.is_shop_member(shop_id);
  if not found then
    raise exception 'Customer not found' using errcode = 'PT404';
  end if;
end;
$$;

create function public.restore_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customers set removed_at = null, removed_by = null
   where id = p_id and removed_at is not null and private.is_shop_member(shop_id);
  if not found then
    raise exception 'Customer not found' using errcode = 'PT404';
  end if;
end;
$$;

create function public.list_removed_customers()
returns table (id uuid, name text, phone text, removed_at timestamptz, removed_by text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.phone, c.removed_at, c.removed_by
    from public.customers c
   where c.removed_at is not null and private.is_shop_member(c.shop_id)
   order by c.removed_at desc
   limit 200;
$$;

-- A sheet already typed in belongs to its bowler, so only sheets still in the
-- queue (waiting, being typed in, or set aside) can be removed.
create function public.remove_intake(p_id uuid, p_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
begin
  select * into v_item from public.intake_items where id = p_id and removed_at is null for update;
  if not found or not private.is_shop_member(v_item.shop_id) then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
  if v_item.status = 'done' then
    raise exception 'This sheet is already in the app. Remove the bowler instead.' using errcode = 'PT409';
  end if;
  update public.intake_items
     set removed_at = now(), removed_by = left(nullif(trim(p_name), ''), 120), claimed_by = null, claimed_at = null,
         status = case when status = 'working' then 'waiting' else status end
   where id = p_id;
end;
$$;

create function public.restore_intake(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.intake_items set removed_at = null, removed_by = null
   where id = p_id and removed_at is not null and private.is_shop_member(shop_id);
  if not found then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
end;
$$;

create function public.list_removed_intake()
returns setof public.intake_items
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.intake_items i
   where i.removed_at is not null and private.is_shop_member(i.shop_id)
   order by i.removed_at desc
   limit 200;
$$;

-- The queue hands out only sheets that are not removed.
create or replace function public.claim_next_intake(p_name text)
returns public.intake_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
begin
  select * into v_item from public.intake_items i
   where private.is_shop_member(i.shop_id)
     and i.removed_at is null
     and (i.status = 'waiting' or (i.status = 'working' and i.claimed_at < now() - interval '1 hour'))
   order by i.created_at, i.id
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;
  update public.intake_items
     set status = 'working', claimed_by = left(nullif(trim(p_name), ''), 120), claimed_at = now()
   where id = v_item.id
   returning * into v_item;
  return v_item;
end;
$$;

-- Counts leave removed sheets out.
create or replace function public.intake_stats(p_tz text default 'UTC')
returns table (name text, typed_today bigint, typed_week bigint, typed_total bigint, added_total bigint, working_now bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = p_tz), 'UTC');
  v_today timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_week timestamptz := date_trunc('week', now() at time zone v_tz) at time zone v_tz;
begin
  return query
  with mine as (
    select * from public.intake_items i where private.is_shop_member(i.shop_id) and i.removed_at is null
  ),
  people as (
    select lower(trim(m.done_by)) as k, m.done_by as shown, m.done_at as at, 'done' as what from mine m
     where m.status = 'done' and nullif(trim(m.done_by), '') is not null
    union all
    select lower(trim(m.added_by)), m.added_by, m.created_at, 'added' from mine m
     where nullif(trim(m.added_by), '') is not null
    union all
    select lower(trim(m.claimed_by)), m.claimed_by, m.claimed_at, 'working' from mine m
     where m.status = 'working' and nullif(trim(m.claimed_by), '') is not null
  )
  select min(p.shown),
         count(*) filter (where p.what = 'done' and p.at >= v_today),
         count(*) filter (where p.what = 'done' and p.at >= v_week),
         count(*) filter (where p.what = 'done'),
         count(*) filter (where p.what = 'added'),
         count(*) filter (where p.what = 'working')
    from people p
   group by p.k
   order by 4 desc, 1;
end;
$$;

revoke all on function public.remove_customer(uuid, text) from public;
revoke all on function public.restore_customer(uuid) from public;
revoke all on function public.list_removed_customers() from public;
revoke all on function public.remove_intake(uuid, text) from public;
revoke all on function public.restore_intake(uuid) from public;
revoke all on function public.list_removed_intake() from public;
grant execute on function public.remove_customer(uuid, text) to anon, authenticated;
grant execute on function public.restore_customer(uuid) to anon, authenticated;
grant execute on function public.list_removed_customers() to anon, authenticated;
grant execute on function public.remove_intake(uuid, text) to anon, authenticated;
grant execute on function public.restore_intake(uuid) to anon, authenticated;
grant execute on function public.list_removed_intake() to anon, authenticated;
