-- Photos of original paper spec sheets. Files live in a private Storage bucket;
-- object paths are <shop_id>/<customer_id>/<photo_id>/<file name>, and only
-- active staff of that shop can read or add them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spec-photos', 'spec-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.spec_photos (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shop_id uuid not null,
  revision_id uuid,
  object_path text not null unique,
  original_filename text check (original_filename is null or length(original_filename) <= 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  -- Display rotation chosen at upload. The stored file is the untouched original.
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270)),
  caption text check (caption is null or length(caption) <= 500),
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now(),
  foreign key (customer_id, shop_id) references public.customers (id, shop_id) on delete cascade,
  foreign key (revision_id, shop_id) references public.fit_revisions (id, shop_id)
);

create index spec_photos_customer_idx on public.spec_photos (customer_id, created_at desc);

-- Fills author, size and type from the authenticated user and the stored object,
-- and checks the object really is in this customer's folder.
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
    new.author_id := auth.uid();
    new.author_name := private.staff_display_name(new.shop_id, auth.uid());
    new.created_at := now();
    if new.revision_id is not null and not exists (
      select 1 from public.fit_revisions r join public.fits f on f.id = r.fit_id
       where r.id = new.revision_id and f.customer_id = new.customer_id
    ) then
      raise exception 'Revision belongs to a different customer' using errcode = 'PT422';
    end if;
  else
    -- Only caption and rotation can change after upload.
    new.id := old.id;
    new.customer_id := old.customer_id;
    new.shop_id := old.shop_id;
    new.revision_id := old.revision_id;
    new.object_path := old.object_path;
    new.original_filename := old.original_filename;
    new.mime_type := old.mime_type;
    new.size_bytes := old.size_bytes;
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
  end if;
  new.caption := nullif(trim(new.caption), '');
  return new;
end;
$$;

create trigger spec_photos_stamp
  before insert or update on public.spec_photos
  for each row execute function private.spec_photos_stamp();

alter table public.spec_photos enable row level security;

create policy "Members can view photos"
  on public.spec_photos for select to authenticated
  using (private.is_shop_member(shop_id));

create policy "Members can add photos"
  on public.spec_photos for insert to authenticated
  with check (private.is_shop_member(shop_id));

create policy "Members can edit photo captions"
  on public.spec_photos for update to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

revoke delete, truncate on public.spec_photos from authenticated;
revoke all on public.spec_photos from anon;

------------------------------------------------------------------------------
-- Storage policies
------------------------------------------------------------------------------

-- True when the path's first two folders are a shop the caller belongs to and
-- a customer of that shop.
create or replace function private.can_access_photo_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_shop uuid;
  v_customer uuid;
begin
  if array_length(v_parts, 1) <> 4 then
    return false;
  end if;
  begin
    v_shop := v_parts[1]::uuid;
    v_customer := v_parts[2]::uuid;
    perform v_parts[3]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return private.is_shop_member(v_shop)
     and exists (select 1 from public.customers c where c.id = v_customer and c.shop_id = v_shop);
end;
$$;

create or replace function private.photo_has_metadata(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.spec_photos p where p.object_path = p_name);
$$;

revoke all on function private.can_access_photo_path(text) from public;
revoke all on function private.photo_has_metadata(text) from public;
grant execute on function private.can_access_photo_path(text) to authenticated;
grant execute on function private.photo_has_metadata(text) to authenticated;

create policy "Staff can read spec photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'spec-photos' and private.can_access_photo_path(name));

create policy "Staff can upload spec photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'spec-photos' and private.can_access_photo_path(name));

-- Lets the app remove a file whose metadata write failed, so failed uploads do
-- not leave orphans. Files that are recorded in spec_photos cannot be deleted.
create policy "Staff can remove unrecorded spec photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'spec-photos'
    and private.can_access_photo_path(name)
    and not private.photo_has_metadata(name)
  );

-- Admin check for orphaned files (uploads older than a day with no metadata row).
create or replace view private.orphaned_spec_photo_objects as
select o.id, o.name, o.created_at, o.metadata ->> 'size' as size_bytes
from storage.objects o
where o.bucket_id = 'spec-photos'
  and o.created_at < now() - interval '1 day'
  and not exists (select 1 from public.spec_photos p where p.object_path = o.name);
