-- Paper sheets can have a back page (layouts are sometimes drawn there), and
-- queue photos are removed once the sheet is in the app, since the bowler's
-- Photos keep their own copy.

alter table public.intake_items add column back_path text unique;

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
  new.back_path := null;
  return new;
end;
$$;

-- Adds (or replaces) the photo of the back of a sheet that is not in the app yet.
create function public.set_intake_back(p_id uuid, p_path text)
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
  if p_path not like v_item.shop_id::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'intake-photos' and o.name = p_path) then
    raise exception 'Uploaded file not found' using errcode = 'PT422';
  end if;
  update public.intake_items set back_path = p_path where id = p_id returning * into v_item;
  return v_item;
end;
$$;

revoke all on function public.set_intake_back(uuid, text) from public;
grant execute on function public.set_intake_back(uuid, text) to anon, authenticated;

-- A file counts as queued when it is the front or the back of a sheet.
create or replace function private.intake_has_item(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.intake_items i where i.object_path = p_name or i.back_path = p_name);
$$;

create or replace function private.intake_path_finished(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.intake_items i
     where (i.object_path = p_name or i.back_path = p_name) and i.status = 'done' and i.photo_id is not null
  );
$$;

revoke all on function private.intake_path_finished(text) from public;
grant execute on function private.intake_path_finished(text) to anon, authenticated;

create policy "Members can remove finished intake photos" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'intake-photos' and private.can_access_intake_path(name) and private.intake_path_finished(name));
