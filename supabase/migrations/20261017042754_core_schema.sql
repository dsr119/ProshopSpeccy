-- Core schema: shops, staff membership, customers, and the access helpers every
-- policy relies on. Only active staff of a shop can see or change that shop's data.

create extension if not exists pg_trgm with schema extensions;

-- Helpers used by row-level security live in a schema the Data API does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

------------------------------------------------------------------------------
-- Shops and staff
------------------------------------------------------------------------------

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.staff_memberships (
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  active boolean not null default true,
  display_name text check (display_name is null or length(display_name) <= 120),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create index staff_memberships_user_idx on public.staff_memberships (user_id) where active;

create or replace function private.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.active
  );
$$;

create or replace function private.is_shop_admin(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'admin'
  );
$$;

-- Name to show for a staff member in history and "last saved by".
create or replace function private.staff_display_name(p_shop_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(m.display_name), ''), m.email, 'Unknown staff member')
  from public.staff_memberships m
  where m.shop_id = p_shop_id and m.user_id = p_user_id;
$$;

revoke all on function private.is_shop_member(uuid) from public;
revoke all on function private.is_shop_admin(uuid) from public;
revoke all on function private.staff_display_name(uuid, uuid) from public;
grant execute on function private.is_shop_member(uuid) to authenticated;
grant execute on function private.is_shop_admin(uuid) to authenticated;
grant execute on function private.staff_display_name(uuid, uuid) to authenticated;

alter table public.shops enable row level security;
alter table public.staff_memberships enable row level security;

create policy "Members can view their shop"
  on public.shops for select to authenticated
  using (private.is_shop_member(id));

-- Staff can see their own membership rows (even inactive ones, so the app can
-- explain why access is denied) and the roster of shops they belong to.
create policy "Staff can view memberships"
  on public.staff_memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.is_shop_member(shop_id));

-- Membership changes go through the admin functions only.
revoke insert, update, delete on public.shops from anon, authenticated;
revoke insert, update, delete on public.staff_memberships from anon, authenticated;
revoke all on public.shops from anon;
revoke all on public.staff_memberships from anon;

------------------------------------------------------------------------------
-- Customers
------------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  name text not null check (length(trim(name)) > 0 and length(name) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  notes text check (notes is null or length(notes) <= 4000),
  -- Lower-cased, whitespace-collapsed name used for case-insensitive partial search.
  name_search text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  -- Digits only, so "(555) 123-4567" and "555.123.4567" match each other.
  phone_digits text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  last_spec_at timestamptz,
  last_spec_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (id, shop_id)
);

create index customers_shop_name_idx on public.customers (shop_id, name_search);
create index customers_name_trgm_idx on public.customers using gin (name_search extensions.gin_trgm_ops);
create index customers_phone_trgm_idx on public.customers using gin (phone_digits extensions.gin_trgm_ops);
create index customers_shop_updated_idx on public.customers (shop_id, updated_at desc);

-- Authorship and timestamps come from the signed-in identity, never from the client.
create or replace function private.customers_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.last_spec_at := null;
    new.last_spec_by := null;
  else
    new.id := old.id;
    new.shop_id := old.shop_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- last_spec_* is maintained by the save functions (which run as the table owner).
    if current_user not in ('postgres', 'supabase_admin') then
      new.last_spec_at := old.last_spec_at;
      new.last_spec_by := old.last_spec_by;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  new.phone := nullif(trim(new.phone), '');
  new.notes := nullif(trim(new.notes), '');
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger customers_stamp
  before insert or update on public.customers
  for each row execute function private.customers_stamp();

alter table public.customers enable row level security;

create policy "Members can view customers"
  on public.customers for select to authenticated
  using (private.is_shop_member(shop_id));

create policy "Members can add customers"
  on public.customers for insert to authenticated
  with check (private.is_shop_member(shop_id));

create policy "Members can edit customers"
  on public.customers for update to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

-- No delete policy: customer records are not deleted from the app in the MVP.
revoke delete on public.customers from authenticated;
revoke all on public.customers from anon;

------------------------------------------------------------------------------
-- Customer search and duplicate detection
------------------------------------------------------------------------------

create or replace function private.like_escape(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Paginated search by partial name (every word must appear, any case) or by
-- phone digits. Runs with the caller's rights, so row-level security applies.
create or replace function public.search_customers(
  p_query text default '',
  p_limit integer default 25,
  p_offset integer default 0
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
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_query = '' then
    v_patterns := array['%'];
  else
    select array_agg('%' || private.like_escape(t) || '%')
      into v_patterns
      from unnest(string_to_array(v_query, ' ')) as t;
  end if;

  return query
  select c.id, c.name, c.phone, c.notes, c.last_spec_at, c.updated_at,
         (select count(*) from public.spec_photos p where p.customer_id = c.id) as photo_count,
         exists (select 1 from public.fits f where f.customer_id = c.id and f.current_revision_id is not null) as has_specs,
         count(*) over () as total_count
  from public.customers c
  where v_query = ''
     or c.name_search like all (v_patterns)
     or (length(v_digits) >= 3 and c.phone_digits like '%' || v_digits || '%')
  order by
    case when v_query = '' then 0 when c.name_search like private.like_escape(v_query) || '%' then 0 else 1 end,
    case when v_query = '' then c.updated_at end desc nulls last,
    c.name_search,
    c.created_at,
    c.id
  limit v_limit offset v_offset;
end;
$$;

-- Possible duplicates shown before creating a customer. Never blocks creation.
create or replace function public.find_possible_duplicates(p_name text, p_phone text default null)
returns table (id uuid, name text, phone text, notes text, reason text)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g')) as name_search,
           nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as phone_digits
  )
  select c.id, c.name, c.phone, c.notes,
         case
           when c.name_search = i.name_search then 'Same name'
           when c.phone_digits = i.phone_digits then 'Same phone'
           else 'Similar name'
         end as reason
  from public.customers c, input i
  where (i.name_search <> '' and c.name_search = i.name_search)
     or (length(i.phone_digits) >= 7 and c.phone_digits = i.phone_digits)
     or (length(i.name_search) >= 4 and extensions.similarity(c.name_search, i.name_search) >= 0.6)
  order by (c.name_search = i.name_search) desc, c.name_search
  limit 10;
$$;
