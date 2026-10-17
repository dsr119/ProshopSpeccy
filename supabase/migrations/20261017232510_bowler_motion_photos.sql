-- Bowler details, ball motion, who wrote the specs, and photo kinds:
-- * Customers get the contact lines from the paper sheet: email, address,
--   city, state, zip, and whether the phone is a mobile.
-- * Fits record one or two handed, rev rate (rpm), axis rotation and tilt
--   (degrees), speed (mph), P.A.P and who wrote the specs.
-- * Photos are a spec sheet or a ball; a spec sheet photo can be marked as
--   confirmed against the digital sheet.

alter table public.customers
  add column email text check (email is null or length(email) <= 200),
  add column address text check (address is null or length(address) <= 200),
  add column city text check (city is null or length(city) <= 100),
  add column state text check (state is null or length(state) <= 50),
  add column zip text check (zip is null or length(zip) <= 20),
  add column phone_mobile boolean not null default false;

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
  new.email := nullif(trim(new.email), '');
  new.address := nullif(trim(new.address), '');
  new.city := nullif(trim(new.city), '');
  new.state := nullif(trim(new.state), '');
  new.zip := nullif(trim(new.zip), '');
  new.name := trim(new.name);
  return new;
end;
$$;

alter table public.spec_photos
  add column kind text not null default 'spec_sheet' check (kind in ('spec_sheet', 'ball')),
  add column confirmed boolean not null default false,
  add column confirmed_at timestamptz,
  add column confirmed_by text,
  add constraint spec_photos_confirm_sheets_only check (kind = 'spec_sheet' or not confirmed);

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

create or replace function private.fit_field_kinds()
returns table (key text, kind text, label text)
language sql
immutable
set search_path = ''
as $$
  values
    ('hand', 'enum_hand', 'Bowling hand'),
    ('play_style', 'enum_play_style', 'One or two handed'),
    ('thumb_mode', 'enum_thumb_mode', 'Thumb mode'),
    ('fit_label', 'text_short', 'Fit label'),
    ('finger_grips', 'enum_grips', 'Finger grips'),
    ('grip_type', 'enum_grip_type', 'Grip type'),
    ('middle_grip_size', 'length', 'Middle finger grip size'),
    ('middle_hole', 'length', 'Middle finger hole size'),
    ('middle_oval', 'text_short', 'Middle finger oval'),
    ('middle_lateral_pitch', 'pitch_lateral', 'Middle finger lateral pitch'),
    ('middle_fr_pitch', 'pitch_fr', 'Middle finger forward/reverse pitch'),
    ('middle_inserts', 'text_short', 'Middle finger inserts'),
    ('ring_grip_size', 'length', 'Ring finger grip size'),
    ('ring_hole', 'length', 'Ring finger hole size'),
    ('ring_oval', 'text_short', 'Ring finger oval'),
    ('ring_lateral_pitch', 'pitch_lateral', 'Ring finger lateral pitch'),
    ('ring_fr_pitch', 'pitch_fr', 'Ring finger forward/reverse pitch'),
    ('ring_inserts', 'text_short', 'Ring finger inserts'),
    ('bridge', 'length', 'Bridge'),
    ('span_type', 'enum_span_type', 'Span shown'),
    ('middle_cut_to_cut', 'length', 'Middle finger cut to cut'),
    ('ring_cut_to_cut', 'length', 'Ring finger cut to cut'),
    ('middle_full_span', 'length', 'Middle finger full span'),
    ('ring_full_span', 'length', 'Ring finger full span'),
    ('middle_cut_to_outer', 'length', 'Middle finger cut to outer'),
    ('ring_cut_to_outer', 'length', 'Ring finger cut to outer'),
    ('middle_actual_cut', 'length', 'Middle span actual-cut'),
    ('ring_actual_cut', 'length', 'Ring span actual-cut'),
    ('thumb_hole', 'length', 'Thumb hole size'),
    ('thumb_oval', 'text_short', 'Thumb oval'),
    ('thumb_lateral_pitch', 'pitch_lateral', 'Thumb lateral pitch'),
    ('thumb_fr_pitch', 'pitch_fr', 'Thumb forward/reverse pitch'),
    ('thumb_oval_angle', 'angle', 'Thumb oval angle'),
    ('thumb_od', 'length', 'Thumb slug size'),
    ('thumb_insert_type', 'enum_thumb_insert', 'Thumb insert type'),
    ('rev_rate', 'stat', 'Rev rate'),
    ('axis_rotation', 'stat', 'Axis rotation'),
    ('axis_tilt', 'stat', 'Axis tilt'),
    ('speed', 'stat', 'Speed'),
    ('pap', 'text_short', 'P.A.P'),
    ('written_by', 'text_short', 'Specs written by'),
    ('finger_insert_details', 'text_long', 'Finger insert details'),
    ('thumb_system_details', 'text_long', 'Thumb system details'),
    ('fitting_notes', 'text_long', 'Fitting notes')
$$;

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

    if f.kind in ('enum_hand', 'enum_thumb_mode', 'enum_span_type', 'enum_thumb_insert', 'enum_grips', 'enum_grip_type', 'enum_play_style', 'text_short', 'text_long') then
      if jsonb_typeof(v_val) <> 'string' then
        raise exception '%: must be text', f.label using errcode = 'PT422';
      end if;
      v_text := nullif(trim(v_val #>> '{}'), '');
      if f.kind = 'enum_hand' and v_text is not null and v_text not in ('right', 'left') then
        raise exception '%: must be right or left', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_thumb_mode' and v_text is not null and v_text not in ('thumb_in', 'no_thumb') then
        raise exception '%: must be thumb-in or no-thumb', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_span_type' and v_text is not null and v_text not in ('cut_to_cut', 'full_span', 'cut_to_outer') then
        raise exception '%: must be full span, cut to cut or cut to outer', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_thumb_insert' and v_text is not null and v_text not in ('IT', 'JOPO', 'Turbo', 'Turbo NX', 'Thumb Slug') then
        raise exception '%: must be IT, JOPO, Turbo, Turbo NX or Thumb Slug', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_grips' and v_text is not null and v_text not in ('no_grips', 'grips') then
        raise exception '%: must be grips or no grips', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_grip_type' and v_text is not null and v_text not in ('std', 'vaccu') then
        raise exception '%: must be STD or Vaccu', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_play_style' and v_text is not null and v_text not in ('one_handed', 'two_handed') then
        raise exception '%: must be one or two handed', f.label using errcode = 'PT422';
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
      if (v_parsed ->> 'n')::numeric > 2 * (v_parsed ->> 'd')::numeric then
        raise exception '%: pitch must be between 0 and 2 inches', f.label using errcode = 'PT422';
      end if;
      if 16 % (v_parsed ->> 'd')::bigint <> 0 then
        raise exception '%: use steps of 1/16 inch', f.label using errcode = 'PT422';
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
      if f.key in ('middle_cut_to_cut', 'ring_cut_to_cut', 'middle_full_span', 'ring_full_span', 'middle_cut_to_outer', 'ring_cut_to_outer') then
        if (v_parsed ->> 'n')::numeric < 2 * (v_parsed ->> 'd')::numeric
           or (v_parsed ->> 'n')::numeric > 6 * (v_parsed ->> 'd')::numeric then
          raise exception '%: span must be between 2 and 6 inches', f.label using errcode = 'PT422';
        end if;
        if 16 % (v_parsed ->> 'd')::bigint <> 0 then
          raise exception '%: use steps of 1/16 inch', f.label using errcode = 'PT422';
        end if;
      end if;
      -- Picked sizes: drilled holes 1/4 to 1 1/4 in 1/64 steps, and fixed lists.
      if f.key in ('middle_hole', 'ring_hole', 'thumb_hole') then
        perform private.check_size(v_parsed, f.label, 0.25, 1.25, 64);
      elsif f.key = 'bridge' then
        perform private.check_size(v_parsed, f.label, 0.125, 0.5, 16);
      elsif f.key in ('middle_grip_size', 'ring_grip_size') then
        perform private.check_size(v_parsed, f.label, 17 / 32.0, 7 / 8.0, 64, array[29 / 32.0]);
      elsif f.kind = 'stat' and (v_parsed ->> 'n')::numeric >
            (case f.key when 'rev_rate' then 1000 when 'speed' then 40 else 90 end) * (v_parsed ->> 'd')::numeric then
        raise exception '%: enter 0 to %', f.label, (case f.key when 'rev_rate' then 1000 when 'speed' then 40 else 90 end)
          using errcode = 'PT422';
      elsif f.key = 'thumb_od' then
        perform private.check_one_of(v_parsed, f.label, array[0.875, 1.125, 1.25, 1.375]);
      end if;
      v_out := v_out || jsonb_build_object(f.key,
        jsonb_build_object('entered', v_text, 'n', v_parsed -> 'n', 'd', v_parsed -> 'd'));
    end if;
  end loop;

  -- Grip type and grip sizes only with grips; grip holes are 7/8, 31/32 or 1 1/32.
  if v_out ->> 'finger_grips' is distinct from 'grips' then
    if v_out ->> 'grip_type' is not null or v_out -> 'middle_grip_size' <> 'null'::jsonb or v_out -> 'ring_grip_size' <> 'null'::jsonb then
      raise exception 'Grip type and grip sizes are only used with grips' using errcode = 'PT422';
    end if;
  else
    perform private.check_one_of(nullif(v_out -> 'middle_hole', 'null'::jsonb), 'Middle finger hole size', array[0.875, 0.96875, 1.03125]);
    perform private.check_one_of(nullif(v_out -> 'ring_hole', 'null'::jsonb), 'Ring finger hole size', array[0.875, 0.96875, 1.03125]);
  end if;

  -- Interchangeable thumb inserts have no hole size or slug size.
  if v_out ->> 'thumb_insert_type' in ('IT', 'JOPO', 'Turbo', 'Turbo NX')
     and (v_out -> 'thumb_hole' <> 'null'::jsonb or v_out -> 'thumb_od' <> 'null'::jsonb) then
    raise exception 'Thumb hole size and slug size are not used with an interchangeable thumb insert' using errcode = 'PT422';
  end if;

  return v_out;
end;
$$;
