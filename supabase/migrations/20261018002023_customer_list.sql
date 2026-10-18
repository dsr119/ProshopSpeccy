-- Customer list for the dashboard: every customer, sorted by last name (or
-- name, phone, newest or recently updated), with how many spec sheets (the
-- digital sheet plus spec sheet photos) and ball photos each one has.

-- The return type changes, so the old version is moved out of the API first.
alter function public.search_customers(text, integer, integer) rename to search_customers_v1;
alter function public.search_customers_v1(text, integer, integer) set schema private;
revoke all on function private.search_customers_v1(text, integer, integer) from public, anon, authenticated;

create function public.search_customers(
  p_query text default '',
  p_limit integer default 25,
  p_offset integer default 0,
  p_sort text default 'last_name'
)
returns table (
  id uuid,
  name text,
  phone text,
  notes text,
  last_spec_at timestamptz,
  updated_at timestamptz,
  photo_count bigint,
  has_specs boolean,
  spec_sheet_count bigint,
  ball_count bigint,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_patterns text[];
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(p_sort, 'last_name');
begin
  if v_sort not in ('last_name', 'name', 'phone', 'created', 'updated') then
    raise exception 'Unknown sort: %', v_sort using errcode = 'PT422';
  end if;
  if v_query = '' then
    v_patterns := array['%'];
  else
    select array_agg('%' || private.like_escape(t) || '%')
      into v_patterns
      from unnest(string_to_array(v_query, ' ')) as t;
  end if;

  return query
  with matches as (
    select c.*,
           (select count(*) from public.spec_photos p where p.customer_id = c.id) as n_photos,
           (select count(*) from public.spec_photos p where p.customer_id = c.id and p.kind = 'spec_sheet') as n_sheet_photos,
           (select count(*) from public.spec_photos p where p.customer_id = c.id and p.kind = 'ball') as n_balls,
           exists (select 1 from public.fits f where f.customer_id = c.id and f.current_revision_id is not null) as specs
    from public.customers c
    where v_query = ''
       or c.name_search like all (v_patterns)
       or (length(v_digits) >= 3 and c.phone_digits like '%' || v_digits || '%')
  )
  select m.id, m.name, m.phone, m.notes, m.last_spec_at, m.updated_at,
         m.n_photos, m.specs, m.n_sheet_photos + (case when m.specs then 1 else 0 end), m.n_balls,
         count(*) over ()
  from matches m
  order by
    case when v_sort = 'last_name' then regexp_replace(m.name_search, '^.* ', '') end,
    case when v_sort = 'phone' then m.phone_digits end nulls last,
    case when v_sort = 'created' then m.created_at end desc,
    case when v_sort = 'updated' then m.updated_at end desc,
    m.name_search,
    m.created_at,
    m.id
  limit v_limit offset v_offset;
end;
$$;
