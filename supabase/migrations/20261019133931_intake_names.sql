-- The intake page asks who you are from a list of names; the admin can add names to it.

create table public.intake_names (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create unique index intake_names_unique_idx on public.intake_names (shop_id, lower(trim(name)));

alter table public.intake_names enable row level security;

create policy "Members can view intake names" on public.intake_names
  for select to anon, authenticated
  using (private.is_shop_member(shop_id));

create function public.add_intake_name(p_shop_id uuid, p_name text)
returns public.intake_names
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_row public.intake_names;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Shop not found' using errcode = 'PT404';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'Enter a name under 120 characters' using errcode = 'PT422';
  end if;
  if lower(v_name) = 'admin' then
    raise exception 'Admin is already on the list' using errcode = 'PT422';
  end if;
  insert into public.intake_names (shop_id, name) values (p_shop_id, v_name)
  on conflict (shop_id, lower(trim(name))) do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception '% is already on the list', v_name using errcode = 'PT409';
  end if;
  return v_row;
end;
$$;

revoke all on function public.add_intake_name(uuid, text) from public;
grant execute on function public.add_intake_name(uuid, text) to anon, authenticated;

insert into public.intake_names (shop_id, name)
select s.id, n.name
  from public.shops s
 cross join unnest(array[
   'Keith Danielowski', 'Amy Danielowski', 'Hannah Danielowski', 'James Durland',
   'Tim Bilski', 'Tony Russo', 'Doug Smith', 'Kayla Wright'
 ]) as n(name)
on conflict do nothing;
