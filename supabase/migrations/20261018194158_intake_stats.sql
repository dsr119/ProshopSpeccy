-- Who has done how much in the intake queue, for the admin view on the intake
-- page. Names are the ones people type on their device, grouped ignoring case
-- and spaces around them. "Today" and "this week" use the viewer's time zone.

create function public.intake_stats(p_tz text default 'UTC')
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
    select * from public.intake_items i where private.is_shop_member(i.shop_id)
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

revoke all on function public.intake_stats(text) from public;
grant execute on function public.intake_stats(text) to anon, authenticated;
