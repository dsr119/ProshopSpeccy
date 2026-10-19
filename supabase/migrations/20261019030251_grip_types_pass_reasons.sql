-- Grip type becomes a list: STD, Vaccu, Oval Mesh, Oval No Mesh, Lifts.
-- Intake sheets can be passed with a reason; they go to the passed pile for someone to look at.

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

  -- The single P.A.P text field became horizontal and vertical before it was ever filled in.
  if p_snapshot -> 'pap' = 'null'::jsonb then
    p_snapshot := p_snapshot - 'pap';
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
      elsif f.kind = 'enum_grip_type' and v_text is not null and v_text not in ('std', 'vaccu', 'oval_mesh', 'oval_no_mesh', 'lifts') then
        raise exception '%: must be STD, Vaccu, Oval Mesh, Oval No Mesh or Lifts', f.label using errcode = 'PT422';
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

    if f.kind in ('pitch_lateral', 'pitch_fr', 'pitch_ud') then
      if v_dir is null or v_dir = '' then
        v_dir := 'none';
      end if;
      if f.kind = 'pitch_lateral' and v_dir not in ('left', 'right', 'none') then
        raise exception '%: direction must be left or right', f.label using errcode = 'PT422';
      end if;
      if f.kind = 'pitch_fr' and v_dir not in ('forward', 'reverse', 'none') then
        raise exception '%: direction must be forward or reverse', f.label using errcode = 'PT422';
      end if;
      if f.kind = 'pitch_ud' and v_dir not in ('up', 'down', 'none') then
        raise exception '%: direction must be up or down', f.label using errcode = 'PT422';
      end if;
      if (v_parsed ->> 'n')::numeric > 2 * (v_parsed ->> 'd')::numeric then
        raise exception '%: % must be between 0 and 2 inches', f.label,
          case when f.kind = 'pitch_ud' then 'amount' else 'pitch' end using errcode = 'PT422';
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
      elsif f.key = 'pap_horizontal' and ((v_parsed ->> 'n')::numeric > 8 * (v_parsed ->> 'd')::numeric
            or 16 % (v_parsed ->> 'd')::bigint <> 0) then
        raise exception '%: choose 0 to 8 inches in 1/16 steps', f.label using errcode = 'PT422';
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

alter table public.intake_items
  add column pass_reason text check (pass_reason is null or pass_reason in
    ('too_blurry', 'dont_understand', 'too_sloppy', 'no_name', 'incomplete_specs', 'no_specs')),
  add column passed_by text check (passed_by is null or length(passed_by) <= 120),
  add column passed_at timestamptz;

-- Passes a sheet with a reason and hands the same person the next one, in one trip.
create function public.pass_intake(p_id uuid, p_reason text, p_note text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  v_next public.intake_items;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or not private.is_shop_member(v_item.shop_id) or v_item.removed_at is not null then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
  if v_item.status = 'done' then
    raise exception 'This sheet is already in the app' using errcode = 'PT409';
  end if;
  if p_reason is null or p_reason not in ('too_blurry', 'dont_understand', 'too_sloppy', 'no_name', 'incomplete_specs', 'no_specs') then
    raise exception 'Pick why you are passing this sheet' using errcode = 'PT422';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'Note: keep this under 500 characters' using errcode = 'PT422';
  end if;
  update public.intake_items
     set status = 'unreadable', pass_reason = p_reason, note = nullif(trim(p_note), ''),
         passed_by = left(nullif(trim(p_name), ''), 120), passed_at = now(),
         claimed_by = null, claimed_at = null
   where id = p_id
   returning * into v_item;

  v_next := public.claim_next_intake(p_name);
  return jsonb_build_object('passed', to_jsonb(v_item), 'next', case when v_next.id is null then null else to_jsonb(v_next) end);
end;
$$;

revoke all on function public.pass_intake(uuid, text, text, text) from public;
grant execute on function public.pass_intake(uuid, text, text, text) to anon, authenticated;
