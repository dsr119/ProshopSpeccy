-- A bowler can have several paper spec sheets (photos) and several digital
-- versions. One of each is marked current. Importing specs from a paper photo
-- saves a new digital version, links it to that photo, and makes both current.
--
-- customers.current_photo_id: the paper sheet photo staff picked as current.
--   When it is empty (or that photo was deleted) the app treats the newest
--   spec sheet photo as current.
-- spec_photos.imported_revision_id: the digital version typed in from this
--   photo with "Import specs". Photos from intake already carry revision_id;
--   revision_id itself never changes after upload, so the link is its own column.

alter table public.customers
  add column current_photo_id uuid references public.spec_photos (id);

alter table public.spec_photos
  add column imported_revision_id uuid references public.fit_revisions (id);

-- Makes an existing version the current digital sheet, without copying it into a
-- new revision (Restore still does that). Later versions stay in the history.
create function public.set_current_revision(p_revision_id uuid, p_expected_lock_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev public.fit_revisions;
  v_fit public.fits;
begin
  select * into v_rev from public.fit_revisions where id = p_revision_id;
  if not found or not private.is_shop_member(v_rev.shop_id) then
    raise exception 'Revision not found' using errcode = 'PT404';
  end if;

  select * into v_fit from public.fits where id = v_rev.fit_id for update;
  if v_fit.lock_version <> coalesce(p_expected_lock_version, -1) then
    perform private.raise_fit_conflict(v_fit);
  end if;

  if v_fit.current_revision_id is distinct from v_rev.id then
    update public.fits
       set current_revision_id = v_rev.id,
           lock_version = lock_version + 1,
           label = v_rev.snapshot ->> 'fit_label'
     where id = v_fit.id
    returning * into v_fit;
  end if;

  return jsonb_build_object(
    'fit_id', v_fit.id,
    'revision_id', v_fit.current_revision_id,
    'revision_number', v_rev.revision_number,
    'lock_version', v_fit.lock_version
  );
end;
$$;

-- Marks a spec sheet photo as the bowler's current paper sheet. With a revision,
-- also records that this photo's specs were imported as that version.
create function public.set_current_photo(p_photo_id uuid, p_revision_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.spec_photos;
begin
  select * into v_photo from public.spec_photos where id = p_photo_id and removed_at is null for update;
  if not found or not private.is_shop_member(v_photo.shop_id) then
    raise exception 'Photo not found' using errcode = 'PT404';
  end if;
  if v_photo.kind <> 'spec_sheet' then
    raise exception 'Only a spec sheet photo can be the current paper sheet' using errcode = 'PT422';
  end if;

  if p_revision_id is not null then
    if not exists (
      select 1 from public.fit_revisions r join public.fits f on f.id = r.fit_id
       where r.id = p_revision_id and f.customer_id = v_photo.customer_id
    ) then
      raise exception 'Revision belongs to a different customer' using errcode = 'PT422';
    end if;
    update public.spec_photos set imported_revision_id = p_revision_id where id = v_photo.id
    returning * into v_photo;
  end if;

  update public.customers set current_photo_id = v_photo.id where id = v_photo.customer_id;

  return jsonb_build_object('current_photo_id', v_photo.id, 'imported_revision_id', v_photo.imported_revision_id);
end;
$$;

revoke all on function public.set_current_revision(uuid, integer) from public;
revoke all on function public.set_current_photo(uuid, uuid) from public;
grant execute on function public.set_current_revision(uuid, integer) to anon, authenticated;
grant execute on function public.set_current_photo(uuid, uuid) to anon, authenticated;
