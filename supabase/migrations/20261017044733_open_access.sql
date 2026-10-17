-- Open-link mode: a shop with open_access = true can be used by anyone who has
-- the app link, without signing in. Turning the flag off restores staff-only
-- access; signed-in staff membership keeps working either way. History and the
-- no-delete rules still apply to everyone.

alter table public.shops add column open_access boolean not null default false;

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
  ) or exists (
    select 1 from public.shops s where s.id = p_shop_id and s.open_access
  );
$$;

-- Saves made without signing in are labelled as coming from the shared link.
create or replace function private.staff_display_name(p_shop_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(trim(m.display_name), ''), m.email, 'Unknown staff member')
       from public.staff_memberships m
      where m.shop_id = p_shop_id and m.user_id = p_user_id),
    case when p_user_id is null then 'Shared link' end
  );
$$;

alter table public.fit_revisions alter column author_id drop not null;

-- Same as before, minus the sign-in requirement; access is still checked per shop.
create or replace function public.save_fit_revision(
  p_customer_id uuid,
  p_expected_lock_version integer,
  p_snapshot jsonb,
  p_change_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_fit public.fits;
  v_snapshot jsonb;
  v_current jsonb;
begin
  select * into v_customer from public.customers where id = p_customer_id;
  if not found or not private.is_shop_member(v_customer.shop_id) then
    raise exception 'Customer not found' using errcode = 'PT404';
  end if;

  if p_change_note is not null and length(p_change_note) > 500 then
    raise exception 'Change note: keep this under 500 characters' using errcode = 'PT422';
  end if;

  v_snapshot := private.normalize_fit_snapshot(p_snapshot);

  select * into v_fit from public.fits
   where customer_id = p_customer_id and is_primary
   for update;

  if not found then
    if coalesce(p_expected_lock_version, 0) <> 0 then
      raise exception 'This fit no longer exists' using errcode = 'PT409';
    end if;
    begin
      insert into public.fits (customer_id, shop_id, created_by)
      values (p_customer_id, v_customer.shop_id, auth.uid())
      returning * into v_fit;
    exception when unique_violation then
      -- Another staff member created the fit at the same moment.
      select * into v_fit from public.fits where customer_id = p_customer_id and is_primary;
      perform private.raise_fit_conflict(v_fit);
    end;
  elsif v_fit.lock_version <> coalesce(p_expected_lock_version, -1) then
    perform private.raise_fit_conflict(v_fit);
  end if;

  if v_fit.current_revision_id is not null then
    select snapshot into v_current from public.fit_revisions where id = v_fit.current_revision_id;
    if v_current = v_snapshot then
      return jsonb_build_object(
        'created', false,
        'fit_id', v_fit.id,
        'revision_id', v_fit.current_revision_id,
        'lock_version', v_fit.lock_version
      );
    end if;
  end if;

  return private.append_fit_revision(v_fit, v_snapshot, p_change_note, null);
end;
$$;

create or replace function public.restore_fit_revision(
  p_revision_id uuid,
  p_expected_lock_version integer,
  p_change_note text default null
)
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

  return private.append_fit_revision(
    v_fit,
    private.normalize_fit_snapshot(v_rev.snapshot),
    coalesce(nullif(trim(p_change_note), ''), 'Restored revision #' || v_rev.revision_number),
    v_rev.id
  );
end;
$$;

grant usage on schema private to anon;
grant execute on function private.is_shop_member(uuid) to anon;
grant execute on function private.staff_display_name(uuid, uuid) to anon;
grant execute on function private.can_access_photo_path(text) to anon;
grant execute on function private.photo_has_metadata(text) to anon;
grant execute on function public.save_fit_revision(uuid, integer, jsonb, text) to anon;
grant execute on function public.restore_fit_revision(uuid, integer, text) to anon;

grant select on public.shops to anon;
grant select, insert, update on public.customers to anon;
grant select on public.fits to anon;
grant select on public.fit_revisions to anon;
grant select, insert, update on public.spec_photos to anon;

alter policy "Members can view their shop" on public.shops to anon, authenticated;
alter policy "Members can view customers" on public.customers to anon, authenticated;
alter policy "Members can add customers" on public.customers to anon, authenticated;
alter policy "Members can edit customers" on public.customers to anon, authenticated;
alter policy "Members can view fits" on public.fits to anon, authenticated;
alter policy "Members can view fit revisions" on public.fit_revisions to anon, authenticated;
alter policy "Members can view photos" on public.spec_photos to anon, authenticated;
alter policy "Members can add photos" on public.spec_photos to anon, authenticated;
alter policy "Members can edit photo captions" on public.spec_photos to anon, authenticated;
alter policy "Staff can read spec photos" on storage.objects to anon, authenticated;
alter policy "Staff can upload spec photos" on storage.objects to anon, authenticated;
alter policy "Staff can remove unrecorded spec photos" on storage.objects to anon, authenticated;
