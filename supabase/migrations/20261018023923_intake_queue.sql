-- Intake queue for backfilling paper spec sheets. Photos of paper sheets go
-- into a queue (their own private bucket), shop staff take one at a time,
-- type it into the digital sheet for the right bowler, and the finished item
-- records which customer and spec sheet photo it became. The queue is used
-- from the separate intake page only; the main app never reads it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intake-photos', 'intake-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.intake_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  object_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  -- waiting: in the queue. working: someone is typing it in. done: in the app.
  -- unreadable: set aside because the paper sheet could not be read.
  status text not null default 'waiting' check (status in ('waiting', 'working', 'done', 'unreadable')),
  added_by text,
  created_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  note text check (note is null or length(note) <= 500),
  customer_id uuid references public.customers (id),
  photo_id uuid references public.spec_photos (id),
  done_by text,
  done_at timestamptz
);

create index intake_items_queue_idx on public.intake_items (shop_id, status, created_at);

alter table public.intake_items enable row level security;

create policy "Members can view the intake queue" on public.intake_items
  for select to anon, authenticated
  using (private.is_shop_member(shop_id));

create policy "Members can add to the intake queue" on public.intake_items
  for insert to anon, authenticated
  with check (private.is_shop_member(shop_id));

revoke all on public.intake_items from anon, authenticated;
grant select, insert on public.intake_items to anon, authenticated;

-- New items always start in the queue, with the stored file's real size and type.
create or replace function private.intake_items_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
begin
  if new.object_path not like new.shop_id::text || '/%' then
    raise exception 'Photo path does not match the shop' using errcode = 'PT422';
  end if;
  select o.metadata into v_meta from storage.objects o
   where o.bucket_id = 'intake-photos' and o.name = new.object_path;
  if not found then
    raise exception 'Uploaded file not found' using errcode = 'PT422';
  end if;
  new.mime_type := coalesce(v_meta ->> 'mimetype', new.mime_type);
  new.size_bytes := coalesce((v_meta ->> 'size')::bigint, new.size_bytes);
  new.added_by := left(nullif(trim(new.added_by), ''), 120);
  new.status := 'waiting';
  -- Photos added together keep the order they were taken in.
  new.created_at := clock_timestamp();
  new.claimed_by := null;
  new.claimed_at := null;
  new.customer_id := null;
  new.photo_id := null;
  new.done_by := null;
  new.done_at := null;
  new.note := null;
  return new;
end;
$$;

create trigger intake_items_stamp before insert on public.intake_items
  for each row execute function private.intake_items_stamp();

-- Takes the oldest sheet nobody is working on. A sheet someone opened more than
-- an hour ago without finishing goes back to the front of the queue.
create function public.claim_next_intake(p_name text)
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

-- Puts a sheet back in the queue, or sets it aside as unreadable with a note.
create function public.release_intake(p_id uuid, p_unreadable boolean default false, p_note text default null)
returns public.intake_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or not private.is_shop_member(v_item.shop_id) then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
  if v_item.status = 'done' then
    raise exception 'This sheet is already in the app' using errcode = 'PT409';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'Note: keep this under 500 characters' using errcode = 'PT422';
  end if;
  update public.intake_items
     set status = case when p_unreadable then 'unreadable' else 'waiting' end,
         note = case when p_unreadable then nullif(trim(p_note), '') else note end,
         claimed_by = null,
         claimed_at = null
   where id = p_id
   returning * into v_item;
  return v_item;
end;
$$;

-- Records that a sheet is in the app: for which customer, and its copy in the customer's photos.
create function public.complete_intake(p_id uuid, p_customer_id uuid, p_photo_id uuid, p_name text)
returns public.intake_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or not private.is_shop_member(v_item.shop_id) then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
  if v_item.status = 'done' then
    raise exception 'This sheet is already in the app' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = v_item.shop_id) then
    raise exception 'Customer not found' using errcode = 'PT404';
  end if;
  if p_photo_id is not null
     and not exists (select 1 from public.spec_photos p where p.id = p_photo_id and p.customer_id = p_customer_id) then
    raise exception 'Photo not found' using errcode = 'PT404';
  end if;
  update public.intake_items
     set status = 'done', customer_id = p_customer_id, photo_id = p_photo_id,
         done_by = left(nullif(trim(p_name), ''), 120), done_at = now()
   where id = p_id
   returning * into v_item;
  return v_item;
end;
$$;

revoke all on function public.claim_next_intake(text) from public;
revoke all on function public.release_intake(uuid, boolean, text) from public;
revoke all on function public.complete_intake(uuid, uuid, uuid, text) from public;
grant execute on function public.claim_next_intake(text) to anon, authenticated;
grant execute on function public.release_intake(uuid, boolean, text) to anon, authenticated;
grant execute on function public.complete_intake(uuid, uuid, uuid, text) to anon, authenticated;

-- Intake photos live under <shop>/<item>/original.<ext>.
create or replace function private.can_access_intake_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_shop uuid;
begin
  if array_length(v_parts, 1) <> 3 then
    return false;
  end if;
  begin
    v_shop := v_parts[1]::uuid;
    perform v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return private.is_shop_member(v_shop);
end;
$$;

create or replace function private.intake_has_item(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.intake_items i where i.object_path = p_name);
$$;

revoke all on function private.can_access_intake_path(text) from public;
revoke all on function private.intake_has_item(text) from public;
grant execute on function private.can_access_intake_path(text) to anon, authenticated;
grant execute on function private.intake_has_item(text) to anon, authenticated;

create policy "Members can read intake photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'intake-photos' and private.can_access_intake_path(name));

create policy "Members can upload intake photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'intake-photos' and private.can_access_intake_path(name));

-- Only a file whose queue entry failed to save can be removed.
create policy "Members can remove unqueued intake photos" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'intake-photos' and private.can_access_intake_path(name) and not private.intake_has_item(name));
