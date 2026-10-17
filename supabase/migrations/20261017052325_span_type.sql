-- Span type: the upper span boxes can record Cut to Cut, Full Span (grip to
-- thumb cut) or Cut to Switch Grip Cut. The value keys keep their original
-- names; spans saved without a type are treated as cut-to-cut.

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
    ('span_type', 'enum_span_type', 'Span measured'),
    ('middle_cut_to_cut', 'length', 'Middle finger span'),
    ('ring_cut_to_cut', 'length', 'Ring finger span'),
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

    if f.kind in ('enum_hand', 'enum_thumb_mode', 'enum_span_type', 'text_short', 'text_long') then
      if jsonb_typeof(v_val) <> 'string' then
        raise exception '%: must be text', f.label using errcode = 'PT422';
      end if;
      v_text := nullif(trim(v_val #>> '{}'), '');
      if f.kind = 'enum_hand' and v_text is not null and v_text not in ('right', 'left') then
        raise exception '%: must be right or left', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_thumb_mode' and v_text is not null and v_text not in ('thumb_in', 'no_thumb') then
        raise exception '%: must be thumb-in or no-thumb', f.label using errcode = 'PT422';
      elsif f.kind = 'enum_span_type' and v_text is not null and v_text not in ('cut_to_cut', 'full_span', 'cut_to_switch') then
        raise exception '%: must be cut to cut, full span or cut to switch grip cut', f.label using errcode = 'PT422';
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
      if 32 % (v_parsed ->> 'd')::bigint <> 0 then
        raise exception '%: use steps of 1/32 inch', f.label using errcode = 'PT422';
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

  -- Spans saved before the span type existed were cut-to-cut.
  if v_out ->> 'span_type' is null
     and (v_out -> 'middle_cut_to_cut' <> 'null'::jsonb or v_out -> 'ring_cut_to_cut' <> 'null'::jsonb) then
    v_out := v_out || '{"span_type": "cut_to_cut"}'::jsonb;
  end if;

  return v_out;
end;
$$;
