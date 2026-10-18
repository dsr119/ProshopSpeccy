-- Photo files can live in Cloudflare R2 (bucket proshop-photos) instead of
-- Supabase Storage, to stay within the free plans. The records stay here; a
-- record's `store` says where its file is. R2 keys start with the old bucket
-- name: spec-photos/<shop>/<customer>/<photo>/<file> and
-- intake-photos/<shop>/<item>/<file>. A typed-in paper sheet's photo is not
-- copied: the bowler's photo record points at the queue's file.

alter table public.spec_photos
  add column store text not null default 'supabase' check (store in ('supabase', 'r2'));
alter table public.intake_items
  add column store text not null default 'supabase' check (store in ('supabase', 'r2')),
  add column back_size_bytes bigint check (back_size_bytes is null or (back_size_bytes > 0 and back_size_bytes <= 15728640));

create or replace function private.spec_photos_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object record;
begin
  if tg_op = 'INSERT' then
    if new.store = 'r2' then
      -- Cloudflare files are checked by the photo-files function when they are
      -- uploaded; here the path must be this customer's folder, or a queued
      -- paper sheet of this shop that is being handed to the customer.
      if not (
        new.object_path like 'spec-photos/' || new.shop_id::text || '/' || new.customer_id::text || '/%'
        or (new.object_path like 'intake-photos/' || new.shop_id::text || '/%' and exists (
          select 1 from public.intake_items i
           where i.shop_id = new.shop_id and i.store = 'r2'
             and (i.object_path = new.object_path or i.back_path = new.object_path)))
      ) then
        raise exception 'Photo path does not match the customer' using errcode = 'PT422';
      end if;
    else
      if new.object_path not like new.shop_id::text || '/' || new.customer_id::text || '/%' then
        raise exception 'Photo path does not match the customer' using errcode = 'PT422';
      end if;
      select o.metadata into v_object
        from storage.objects o
       where o.bucket_id = 'spec-photos' and o.name = new.object_path;
      if not found then
        raise exception 'Uploaded file not found' using errcode = 'PT422';
      end if;
      new.mime_type := coalesce(v_object.metadata ->> 'mimetype', new.mime_type);
      new.size_bytes := coalesce((v_object.metadata ->> 'size')::bigint, new.size_bytes);
    end if;
    new.author_id := auth.uid();
    new.author_name := private.staff_display_name(new.shop_id, auth.uid());
    new.created_at := now();
    new.confirmed := false;
    new.confirmed_at := null;
    new.confirmed_by := null;
    if new.revision_id is not null and not exists (
      select 1 from public.fit_revisions r join public.fits f on f.id = r.fit_id
       where r.id = new.revision_id and f.customer_id = new.customer_id
    ) then
      raise exception 'Revision belongs to a different customer' using errcode = 'PT422';
    end if;
  else
    -- Only caption, rotation, kind and the confirmed mark can change after upload.
    new.id := old.id;
    new.customer_id := old.customer_id;
    new.shop_id := old.shop_id;
    new.revision_id := old.revision_id;
    new.object_path := old.object_path;
    new.store := old.store;
    new.original_filename := old.original_filename;
    new.mime_type := old.mime_type;
    new.size_bytes := old.size_bytes;
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
    if new.confirmed is distinct from old.confirmed then
      new.confirmed_at := case when new.confirmed then now() end;
      new.confirmed_by := case when new.confirmed then private.staff_display_name(new.shop_id, auth.uid()) end;
    else
      new.confirmed_at := old.confirmed_at;
      new.confirmed_by := old.confirmed_by;
    end if;
  end if;
  new.caption := nullif(trim(new.caption), '');
  return new;
end;
$$;

create or replace function private.intake_items_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
begin
  if new.store = 'r2' then
    if new.object_path not like 'intake-photos/' || new.shop_id::text || '/' || new.id::text || '/%' then
      raise exception 'Photo path does not match the shop' using errcode = 'PT422';
    end if;
  else
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
  end if;
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
  new.back_size_bytes := null;
  return new;
end;
$$;

-- Adds (or replaces) the photo of the back of a sheet that is not in the app
-- yet, with its size (taken from the stored file when it is in Supabase).
create function public.set_intake_back(p_id uuid, p_path text, p_size bigint)
returns public.intake_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  v_size bigint := p_size;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or not private.is_shop_member(v_item.shop_id) then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
  if v_item.status = 'done' then
    raise exception 'This sheet is already in the app' using errcode = 'PT409';
  end if;
  if v_item.store = 'r2' then
    if p_path not like 'intake-photos/' || v_item.shop_id::text || '/' || v_item.id::text || '/%' then
      raise exception 'Uploaded file not found' using errcode = 'PT422';
    end if;
  else
    select (o.metadata ->> 'size')::bigint into v_size from storage.objects o
     where o.bucket_id = 'intake-photos' and o.name = p_path and p_path like v_item.shop_id::text || '/%';
    if not found then
      raise exception 'Uploaded file not found' using errcode = 'PT422';
    end if;
  end if;
  update public.intake_items set back_path = p_path, back_size_bytes = coalesce(v_size, p_size)
   where id = p_id returning * into v_item;
  return v_item;
end;
$$;

revoke all on function public.set_intake_back(uuid, text, bigint) from public;
grant execute on function public.set_intake_back(uuid, text, bigint) to anon, authenticated;

-- Used by the photo-files function, as the caller, before it hands out a link
-- to an R2 file. get: view. put: upload a new file. delete: remove a file that
-- no record uses (cleaning up after a failed save).
create or replace function public.r2_keys_allowed(p_keys text[], p_op text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_parts text[];
  v_shop uuid;
  v_customer uuid;
  v_used boolean;
begin
  if p_op not in ('get', 'put', 'delete') or coalesce(array_length(p_keys, 1), 0) not between 1 and 50 then
    return false;
  end if;
  foreach v_key in array p_keys loop
    if v_key is null or v_key !~ '^[a-z-]+(/[A-Za-z0-9._-]+)+$' or v_key ~ '(^|/)\.\.?(/|$)' then
      return false;
    end if;
    v_parts := string_to_array(v_key, '/');
    begin
      v_shop := v_parts[2]::uuid;
      if v_parts[1] = 'spec-photos' and array_length(v_parts, 1) = 5 then
        v_customer := v_parts[3]::uuid;
        if not exists (select 1 from public.customers c where c.id = v_customer and c.shop_id = v_shop) then
          return false;
        end if;
      elsif not (v_parts[1] = 'intake-photos' and array_length(v_parts, 1) = 4) then
        return false;
      end if;
    exception when invalid_text_representation then
      return false;
    end;
    if not private.is_shop_member(v_shop) then
      return false;
    end if;
    if p_op <> 'get' then
      select exists (select 1 from public.spec_photos p where p.object_path = v_key)
          or exists (select 1 from public.intake_items i where i.object_path = v_key or i.back_path = v_key)
        into v_used;
      if v_used then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.r2_keys_allowed(text[], text) from public;
grant execute on function public.r2_keys_allowed(text[], text) to anon, authenticated;
