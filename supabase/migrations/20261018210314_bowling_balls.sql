-- A bowler's bowling balls: the ball, its weight and its layout, as written on
-- the back of the paper spec sheet. They are kept per customer, apart from the
-- measurement revisions, and saved as a whole list from the spec sheet editor.
-- A ball taken off the list is marked removed, not erased, so the record of
-- what a bowler used to throw is kept.

create table public.bowling_balls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shop_id uuid not null,
  position integer not null default 0,
  name text not null check (length(trim(name)) between 1 and 120),
  weight_lbs smallint check (weight_lbs is null or weight_lbs between 6 and 16),
  layout text check (layout is null or length(layout) <= 120),
  notes text check (notes is null or length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (customer_id, shop_id) references public.customers (id, shop_id) on delete cascade
);

create index bowling_balls_customer_idx on public.bowling_balls (customer_id, position) where removed_at is null;

alter table public.bowling_balls enable row level security;

create policy "Members can view bowling balls" on public.bowling_balls
  for select to anon, authenticated
  using (private.is_shop_member(shop_id));

revoke all on public.bowling_balls from anon, authenticated;
grant select on public.bowling_balls to anon, authenticated;

-- Replaces a customer's balls with the given list, in order. Each item is
-- {id?, name, weight_lbs?, layout?, notes?}; items without a known id are new,
-- and balls left out of the list are marked removed.
create function public.save_bowling_balls(p_customer_id uuid, p_balls jsonb)
returns setof public.bowling_balls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_ball jsonb;
  v_pos integer := 0;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_name text;
  v_weight smallint;
  v_layout text;
  v_notes text;
begin
  select c.shop_id into v_shop from public.customers c where c.id = p_customer_id;
  if not found or not private.is_shop_member(v_shop) then
    raise exception 'Customer not found' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_balls) <> 'array' or jsonb_array_length(p_balls) > 100 then
    raise exception 'Send a list of up to 100 balls' using errcode = 'PT422';
  end if;

  for v_ball in select * from jsonb_array_elements(p_balls) loop
    v_pos := v_pos + 1;
    v_name := nullif(trim(v_ball ->> 'name'), '');
    if v_name is null then
      raise exception 'Ball %: give it a name', v_pos using errcode = 'PT422';
    end if;
    if length(v_name) > 120 then
      raise exception 'Ball %: keep the name under 120 characters', v_pos using errcode = 'PT422';
    end if;
    begin
      v_weight := nullif(trim(v_ball ->> 'weight_lbs'), '')::smallint;
    exception when others then
      raise exception 'Ball %: weight must be a whole number of pounds', v_pos using errcode = 'PT422';
    end;
    if v_weight is not null and (v_weight < 6 or v_weight > 16) then
      raise exception 'Ball %: weight must be 6 to 16 lb', v_pos using errcode = 'PT422';
    end if;
    v_layout := nullif(trim(v_ball ->> 'layout'), '');
    if length(v_layout) > 120 then
      raise exception 'Ball %: keep the layout under 120 characters', v_pos using errcode = 'PT422';
    end if;
    v_notes := nullif(trim(v_ball ->> 'notes'), '');
    if length(v_notes) > 300 then
      raise exception 'Ball %: keep the notes under 300 characters', v_pos using errcode = 'PT422';
    end if;

    v_id := null;
    begin
      v_id := (v_ball ->> 'id')::uuid;
    exception when invalid_text_representation then
      v_id := null;
    end;
    update public.bowling_balls b
       set position = v_pos, name = v_name, weight_lbs = v_weight, layout = v_layout, notes = v_notes, removed_at = null,
           updated_at = case when (b.name, b.weight_lbs, b.layout, b.notes) is distinct from (v_name, v_weight, v_layout, v_notes)
                             then now() else b.updated_at end
     where b.id = v_id and b.customer_id = p_customer_id
    returning b.id into v_id;
    if v_id is null then
      insert into public.bowling_balls (customer_id, shop_id, position, name, weight_lbs, layout, notes)
      values (p_customer_id, v_shop, v_pos, v_name, v_weight, v_layout, v_notes)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  update public.bowling_balls b set removed_at = now()
   where b.customer_id = p_customer_id and b.removed_at is null and not (b.id = any (v_keep));

  return query select * from public.bowling_balls b
    where b.customer_id = p_customer_id and b.removed_at is null order by b.position;
end;
$$;

revoke all on function public.save_bowling_balls(uuid, jsonb) from public;
grant execute on function public.save_bowling_balls(uuid, jsonb) to anon, authenticated;
