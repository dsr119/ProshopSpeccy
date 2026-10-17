-- Fits, immutable revisions, measurement validation, and the atomic save and
-- restore functions. Field keys and rules mirror src/measurements/schema.ts.

------------------------------------------------------------------------------
-- Measurement parsing
------------------------------------------------------------------------------

-- Parses a measurement as typed by staff ("4 3/8", "3/8", "4.375", "4-3/8")
-- into an exact reduced fraction {n, d}. Raises PT422 with a readable message
-- on malformed input. Mirrors parseMeasurement() in src/measurements/fraction.ts.
create or replace function private.parse_measurement(p_text text, p_signed boolean, p_label text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(trim(coalesce(p_text, '')));
  v_negative boolean := false;
  m text[];
  v_whole numeric := 0;
  v_num numeric;
  v_den numeric;
  v_g numeric;
begin
  -- Optional trailing unit marks.
  v := trim(regexp_replace(v, '\s*(inches|inch|in|"|''''|degrees|degree|deg|°)$', ''));
  v := regexp_replace(v, '\s+', ' ', 'g');
  if v = '' then
    raise exception '%: enter a number or leave it blank', p_label using errcode = 'PT422';
  end if;

  if left(v, 1) = '-' then
    if not p_signed then
      raise exception '%: cannot be negative', p_label using errcode = 'PT422';
    end if;
    v_negative := true;
    v := trim(substr(v, 2));
  end if;

  if v ~ '^\d{1,6}$' then
    v_num := v::numeric; v_den := 1;
  elsif v ~ '^\d{0,6}\.\d{1,6}$' then
    m := regexp_match(v, '^(\d{0,6})\.(\d{1,6})$');
    v_den := ('1' || repeat('0', length(m[2])))::numeric;
    v_num := coalesce(nullif(m[1], '')::numeric, 0) * v_den + m[2]::numeric;
  elsif v ~ '^\d{1,6} ?/ ?\d{1,6}$' then
    m := regexp_match(v, '^(\d{1,6}) ?/ ?(\d{1,6})$');
    v_num := m[1]::numeric; v_den := m[2]::numeric;
    if v_den = 0 then
      raise exception '%: the bottom of a fraction cannot be zero', p_label using errcode = 'PT422';
    end if;
  elsif v ~ '^\d{1,6}( |-| - )\d{1,6} ?/ ?\d{1,6}$' then
    m := regexp_match(v, '^(\d{1,6})(?: |-| - )(\d{1,6}) ?/ ?(\d{1,6})$');
    v_whole := m[1]::numeric; v_num := m[2]::numeric; v_den := m[3]::numeric;
    if v_den = 0 then
      raise exception '%: the bottom of a fraction cannot be zero', p_label using errcode = 'PT422';
    end if;
    if v_num >= v_den then
      raise exception '%: in a mixed number like 4 3/8 the fraction must be less than 1', p_label using errcode = 'PT422';
    end if;
    v_num := v_whole * v_den + v_num;
  else
    raise exception '%: "%" is not a number. Use forms like 4 3/8, 3/8 or 4.375', p_label, trim(p_text)
      using errcode = 'PT422';
  end if;

  v_g := gcd(v_num, v_den);
  if v_g > 1 then
    v_num := div(v_num, v_g); v_den := div(v_den, v_g);
  end if;
  if v_num = 0 then
    v_den := 1; v_negative := false;
  end if;
  if v_negative then
    v_num := -v_num;
  end if;
  return jsonb_build_object('n', v_num::bigint, 'd', v_den::bigint);
end;
$$;

-- Field catalogue for snapshot schema version 1.
create or replace function private.fit_field_kinds()
returns table (key text, kind text, label text)
language sql
immutable
set search_path = ''
as $$
  values
    ('hand', 'enum_hand', 'Bowling hand'),
    ('thumb_mode', 'enum_thumb_mode', 'Thumb mode'),
    ('fit_label', 'text_short', 'Fit label'),
    ('middle_hole', 'length', 'Middle finger hole size'),
    ('middle_oval', 'text_short', 'Middle finger oval'),
    ('middle_lateral_pitch', 'pitch_lateral', 'Middle finger lateral pitch'),
    ('middle_fr_pitch', 'pitch_fr', 'Middle finger forward/reverse pitch'),
    ('ring_hole', 'length', 'Ring finger hole size'),
    ('ring_oval', 'text_short', 'Ring finger oval'),
    ('ring_lateral_pitch', 'pitch_lateral', 'Ring finger lateral pitch'),
    ('ring_fr_pitch', 'pitch_fr', 'Ring finger forward/reverse pitch'),
    ('middle_cut_to_cut', 'length', 'Middle span cut-to-cut'),
    ('ring_cut_to_cut', 'length', 'Ring span cut-to-cut'),
    ('middle_actual_cut', 'length', 'Middle span actual-cut'),
    ('ring_actual_cut', 'length', 'Ring span actual-cut'),
    ('thumb_hole', 'length', 'Thumb hole size'),
    ('thumb_oval', 'text_short', 'Thumb oval'),
    ('thumb_lateral_pitch', 'pitch_lateral', 'Thumb lateral pitch'),
    ('thumb_fr_pitch', 'pitch_fr', 'Thumb forward/reverse pitch'),
    ('thumb_oval_angle', 'angle', 'Thumb oval angle'),
    ('finger_insert_details', 'text_long', 'Finger insert details'),
    ('thumb_system_details', 'text_long', 'Thumb system details'),
    ('fitting_notes', 'text_long', 'Fitting notes')
$$;

-- Validates a snapshot sent by the app and returns its canonical form: every
-- known key present, null meaning "not recorded", numeric values carrying
-- the entered text plus an exact fraction. Unknown keys are rejected.
create or replace function private.normalize_fit_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  f record;
  v_val jsonb;
  v_text text;
  v_dir text;
  v_parsed jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Measurements must be an object' using errcode = 'PT422';
  end if;

  for v_key in select jsonb_object_keys(p_snapshot) loop
    if not exists (select 1 from private.fit_field_kinds() k where k.key = v_key) then
      raise exception 'Unknown measurement field: %', v_key using errcode = 'PT422';
    end if;
  end loop;

  for f in select * from private.fit_field_kinds() loop
    v_val := p_snapshot -> f.key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      v_out := v_out || jsonb_build_object(f.key, null);
      continue;
    end if;

    if f.kind in ('enum_hand', 'enum_thumb_mode', 'text_short', 'text_long') then
      if jsonb_typeof(v_val) <> 'string' then
        raise exception '%: must be text', f.label using errcode = 'PT422';
      end if;
      v_text := nullif(trim(v_val #>> '{}'), '');
      if f.kind = 'enum_hand' and v_text is not null and v_text not in ('right', 'left') then
        raise exception '%: must be right or left', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_thumb_mode' and v_text is not null and v_text not in ('thumb_in', 'no_thumb') then
        raise exception '%: must be thumb-in or no-thumb', f.label using errcode = 'PT422';
      elsif f.kind = 'text_short' and length(v_text) > 120 then
        raise exception '%: keep this under 120 characters', f.label using errcode = 'PT422';
      elsif f.kind = 'text_long' and length(v_text) > 4000 then
        raise exception '%: keep this under 4000 characters', f.label using errcode = 'PT422';
      end if;
      v_out := v_out || jsonb_build_object(f.key, v_text);
      continue;
    end if;

    -- Numeric kinds: {"entered": "4 3/8"} plus "dir" for pitches.
    if jsonb_typeof(v_val) <> 'object' then
      raise exception '%: invalid value', f.label using errcode = 'PT422';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_val) k
      where k not in ('entered', 'dir', 'n', 'd')
    ) then
      raise exception '%: invalid value', f.label using errcode = 'PT422';
    end if;
    if jsonb_typeof(v_val -> 'entered') is distinct from 'string' then
      raise exception '%: invalid value', f.label using errcode = 'PT422';
    end if;
    v_text := regexp_replace(trim(v_val ->> 'entered'), '\s+', ' ', 'g');
    if length(v_text) > 40 then
      raise exception '%: value is too long', f.label using errcode = 'PT422';
    end if;
    v_dir := v_val ->> 'dir';

    if v_text = '' then
      if v_dir is not null and v_dir <> 'none' then
        raise exception '%: enter an amount for the % direction', f.label, v_dir using errcode = 'PT422';
      end if;
      v_out := v_out || jsonb_build_object(f.key, null);
      continue;
    end if;

    v_parsed := private.parse_measurement(v_text, f.kind = 'angle', f.label);

    if f.kind in ('pitch_lateral', 'pitch_fr') then
      if v_dir is null or v_dir = '' then
        v_dir := 'none';
      end if;
      if f.kind = 'pitch_lateral' and v_dir not in ('left', 'right', 'none') then
        raise exception '%: direction must be left or right', f.label using errcode = 'PT422';
      end if;
      if f.kind = 'pitch_fr' and v_dir not in ('forward', 'reverse', 'none') then
        raise exception '%: direction must be forward or reverse', f.label using errcode = 'PT422';
      end if;
      if v_dir = 'none' and (v_parsed ->> 'n')::numeric <> 0 then
        raise exception '%: choose a direction for a non-zero pitch', f.label using errcode = 'PT422';
      end if;
      v_out := v_out || jsonb_build_object(f.key,
        jsonb_build_object('entered', v_text, 'n', v_parsed -> 'n', 'd', v_parsed -> 'd', 'dir', v_dir));
    else
      if v_dir is not null then
        raise exception '%: does not take a direction', f.label using errcode = 'PT422';
      end if;
      v_out := v_out || jsonb_build_object(f.key,
        jsonb_build_object('entered', v_text, 'n', v_parsed -> 'n', 'd', v_parsed -> 'd'));
    end if;
  end loop;

  return v_out;
end;
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.fits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shop_id uuid not null,
  label text check (label is null or length(label) <= 120),
  -- The initial UI uses exactly one primary fit per customer. Named fits can be
  -- added later as non-primary rows without changing customers.
  is_primary boolean not null default true,
  current_revision_id uuid,
  lock_version integer not null default 0 check (lock_version >= 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (id, shop_id),
  foreign key (customer_id, shop_id) references public.customers (id, shop_id) on delete cascade
);

create unique index fits_one_primary_per_customer on public.fits (customer_id) where is_primary;

create table public.fit_revisions (
  id uuid primary key default gen_random_uuid(),
  fit_id uuid not null,
  shop_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  schema_version integer not null default 1,
  snapshot jsonb not null,
  change_note text check (change_note is null or length(change_note) <= 500),
  restored_from_revision_id uuid references public.fit_revisions (id),
  author_id uuid not null,
  author_name text,
  created_at timestamptz not null default now(),
  unique (fit_id, revision_number),
  unique (id, shop_id),
  unique (fit_id, id),
  foreign key (fit_id, shop_id) references public.fits (id, shop_id) on delete cascade
);

-- The current revision must belong to the same fit.
alter table public.fits
  add constraint fits_current_revision_fk
  foreign key (id, current_revision_id) references public.fit_revisions (fit_id, id);

create index fit_revisions_fit_idx on public.fit_revisions (fit_id, revision_number desc);

-- History is append-only.
create or replace function private.fit_revisions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Allow cascades when a whole customer is removed by an administrator in SQL.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Fit revisions cannot be changed or deleted' using errcode = 'PT403';
end;
$$;

create trigger fit_revisions_immutable
  before update or delete on public.fit_revisions
  for each row execute function private.fit_revisions_immutable();

alter table public.fits enable row level security;
alter table public.fit_revisions enable row level security;

create policy "Members can view fits"
  on public.fits for select to authenticated
  using (private.is_shop_member(shop_id));

create policy "Members can view fit revisions"
  on public.fit_revisions for select to authenticated
  using (private.is_shop_member(shop_id));

-- All writes go through save_fit_revision / restore_fit_revision.
revoke insert, update, delete, truncate on public.fits from anon, authenticated;
revoke insert, update, delete, truncate on public.fit_revisions from anon, authenticated;
revoke all on public.fits from anon;
revoke all on public.fit_revisions from anon;

------------------------------------------------------------------------------
-- Save and restore
------------------------------------------------------------------------------

create or replace function private.raise_fit_conflict(p_fit public.fits)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_rev public.fit_revisions;
begin
  select * into v_rev from public.fit_revisions where id = p_fit.current_revision_id;
  raise exception 'Someone else saved this fit since you started editing'
    using errcode = 'PT409',
          detail = jsonb_build_object(
            'lock_version', p_fit.lock_version,
            'revision_id', v_rev.id,
            'revision_number', v_rev.revision_number,
            'author_name', v_rev.author_name,
            'created_at', v_rev.created_at
          )::text;
end;
$$;

create or replace function private.append_fit_revision(
  p_fit public.fits,
  p_snapshot jsonb,
  p_change_note text,
  p_restored_from uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev public.fit_revisions;
  v_fit public.fits;
begin
  insert into public.fit_revisions (
    fit_id, shop_id, revision_number, schema_version, snapshot, change_note,
    restored_from_revision_id, author_id, author_name
  )
  values (
    p_fit.id, p_fit.shop_id,
    (select coalesce(max(r.revision_number), 0) + 1 from public.fit_revisions r where r.fit_id = p_fit.id),
    1, p_snapshot, nullif(trim(p_change_note), ''),
    p_restored_from, v_uid, private.staff_display_name(p_fit.shop_id, v_uid)
  )
  returning * into v_rev;

  update public.fits
     set current_revision_id = v_rev.id,
         lock_version = lock_version + 1,
         label = p_snapshot ->> 'fit_label'
   where id = p_fit.id
  returning * into v_fit;

  update public.customers
     set last_spec_at = v_rev.created_at,
         last_spec_by = v_uid
   where id = p_fit.customer_id;

  return jsonb_build_object(
    'created', true,
    'fit_id', v_fit.id,
    'revision_id', v_rev.id,
    'revision_number', v_rev.revision_number,
    'lock_version', v_fit.lock_version,
    'created_at', v_rev.created_at
  );
end;
$$;

-- Saves the customer's primary fit as a new revision in one transaction.
-- p_expected_lock_version is the lock_version the editor started from (0 when
-- the customer has no fit yet). A mismatch raises PT409 (HTTP 409) instead of
-- overwriting someone else's save. Saving unchanged values creates nothing.
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
  if auth.uid() is null then
    raise exception 'Sign in to save' using errcode = 'PT401';
  end if;

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

-- Restores an older revision by copying its snapshot into a new current
-- revision. Nothing in the history is removed.
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
  if auth.uid() is null then
    raise exception 'Sign in to restore' using errcode = 'PT401';
  end if;

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

revoke all on function public.save_fit_revision(uuid, integer, jsonb, text) from public, anon;
revoke all on function public.restore_fit_revision(uuid, integer, text) from public, anon;
grant execute on function public.save_fit_revision(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.restore_fit_revision(uuid, integer, text) to authenticated;

revoke all on function private.parse_measurement(text, boolean, text) from public;
revoke all on function private.normalize_fit_snapshot(jsonb) from public;
revoke all on function private.append_fit_revision(public.fits, jsonb, text, uuid) from public;
revoke all on function private.raise_fit_conflict(public.fits) from public;
