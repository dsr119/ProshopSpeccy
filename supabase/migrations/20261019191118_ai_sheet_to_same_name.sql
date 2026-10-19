-- A held sheet whose solid name (see private.add_ai_bowler) matches exactly one
-- bowler already in the app goes into that bowler's spec history as an
-- unchecked entry: a new revision that is NOT made current, with the paper
-- photos attached to it. Staff compare it on the History page with the current
-- sheet and the photo, and restore it if it is right. The sheet stays waiting in
-- the intake queue, linked to the bowler, until the bowler is confirmed.
-- Sheets that match only by phone are left alone.

-- The reading in the app's shape, value by value as private.add_ai_bowler builds
-- it: {payload, left_out}. Values the app rejects are left out and named.
create function private.ai_read_payload(r jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  f jsonb;
  v_span text;
  v_key text;
  v_kind text;
  v_text text;
  v_value jsonb;
  v_payload jsonb;
  v_left_out text[] := '{}';
begin
  select coalesce(max(e ->> 'text') filter (where e ->> 'text' in ('cut_to_cut', 'full_span', 'cut_to_outer')), 'cut_to_cut')
    into v_span
    from jsonb_array_elements(r -> 'fields') e
   where e ->> 'key' = 'span_type';
  v_payload := jsonb_build_object('span_type', v_span);
  if exists (select 1 from jsonb_array_elements(r -> 'fields') e
              where e ->> 'key' in ('middle_grip_size', 'ring_grip_size', 'grip_type') and nullif(trim(e ->> 'text'), '') is not null) then
    v_payload := v_payload || jsonb_build_object('finger_grips', 'grips');
  end if;
  for f in select * from jsonb_array_elements(r -> 'fields') loop
    v_key := f ->> 'key';
    v_text := nullif(trim(f ->> 'text'), '');
    if v_key in ('middle_span', 'ring_span') then
      v_key := split_part(v_key, '_', 1) || '_' || v_span;
    end if;
    if v_key in ('middle_grip_size', 'ring_grip_size') and v_text ~ '^\d+/32$'
       and split_part(v_text, '/', 1)::integer between 33 and 63 then
      v_text := split_part(v_text, '/', 1) || '/64';
    end if;
    v_kind := null;
    select k.kind into v_kind from private.fit_field_kinds() k where k.key = v_key;
    if v_kind is null or v_text is null or v_key = 'span_type' or (v_key = 'finger_grips' and v_payload ? 'finger_grips') then
      continue;
    end if;
    if (v_key in ('middle_inserts', 'ring_inserts') and v_text not in ('Oval Mesh', 'Oval No Mesh', 'Lifts'))
       or (v_key in ('middle_grip_brand', 'ring_grip_brand') and v_text not in ('Turbo', 'Vise', 'Other')) then
      v_left_out := v_left_out || (v_key || ' "' || coalesce(f ->> 'written', v_text) || '"');
      continue;
    end if;
    v_value := case
      when v_kind in ('enum_hand', 'enum_thumb_mode', 'enum_span_type', 'enum_thumb_insert', 'enum_grips',
                      'enum_grip_type', 'enum_play_style', 'text_short', 'text_long') then to_jsonb(v_text)
      when v_kind in ('pitch_lateral', 'pitch_fr', 'pitch_ud') then
        jsonb_strip_nulls(jsonb_build_object('entered', v_text, 'dir', nullif(trim(f ->> 'dir'), '')))
      else jsonb_build_object('entered', v_text)
    end;
    begin
      perform private.normalize_fit_snapshot(v_payload || jsonb_build_object(v_key, v_value));
      v_payload := v_payload || jsonb_build_object(v_key, v_value);
    exception when others then
      v_left_out := v_left_out || (v_key || ' "' || coalesce(f ->> 'written', v_text) || '"');
    end;
  end loop;
  return jsonb_build_object('payload', v_payload, 'left_out', to_jsonb(v_left_out));
end;
$$;

revoke all on function private.ai_read_payload(jsonb) from public;

create function private.add_ai_sheet_to_same_name(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  r jsonb;
  v_name text;
  v_built jsonb;
  v_left_out text[];
  v_snapshot jsonb;
  v_customer uuid;
  v_count integer;
  v_fit public.fits;
  v_rev uuid;
  v_front uuid;
  v_ext text;
  v_note text;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or v_item.removed_at is not null or v_item.status <> 'waiting' or v_item.store <> 'r2'
     or v_item.customer_id is not null then
    return jsonb_build_object('id', p_id, 'skipped', 'not a waiting sheet without a bowler');
  end if;
  r := v_item.read_sheet;
  if r is null or coalesce((r ->> 'v')::integer, 0) < 4 or r ? 'error' then
    return jsonb_build_object('id', p_id, 'skipped', 'no full-sheet reading');
  end if;
  v_name := regexp_replace(trim(coalesce(r ->> 'name', '')), '\s+', ' ', 'g');
  if v_name = '' or coalesce(r -> 'unsure', '[]'::jsonb) ? 'name'
     or lower(v_name) <> lower(regexp_replace(trim(coalesce(v_item.read_name, '')), '\s+', ' ', 'g')) then
    return jsonb_build_object('id', p_id, 'skipped', 'name not solid');
  end if;

  select count(*), min(c.id::text)::uuid into v_count, v_customer
    from public.customers c
   where c.shop_id = v_item.shop_id and c.removed_at is null and c.name_search = lower(v_name);
  if v_count <> 1 then
    return jsonb_build_object('id', p_id, 'skipped', v_count || ' bowlers with this name');
  end if;
  if exists (select 1 from public.spec_photos p where p.object_path in (v_item.object_path, v_item.back_path)) then
    return jsonb_build_object('id', p_id, 'skipped', 'photo already in the app');
  end if;

  begin
    v_built := private.ai_read_payload(r);
    select coalesce(array_agg(x), '{}') into v_left_out from jsonb_array_elements_text(v_built -> 'left_out') x;
    v_snapshot := private.normalize_fit_snapshot(v_built -> 'payload');

    v_note := 'Another paper sheet for this bowler, read by AI, not checked yet: compare it with the current sheet and the paper photo, and restore it if it is right';
    if cardinality(v_left_out) > 0 then
      v_note := v_note || '. Left out (the app would not take them): ' || array_to_string(v_left_out, ', ');
    end if;

    select * into v_fit from public.fits where customer_id = v_customer and is_primary for update;
    if not found then
      insert into public.fits (customer_id, shop_id) values (v_customer, v_item.shop_id) returning * into v_fit;
    end if;
    insert into public.fit_revisions (fit_id, shop_id, revision_number, schema_version, snapshot, change_note, author_name)
    values (v_fit.id, v_item.shop_id,
            (select coalesce(max(x.revision_number), 0) + 1 from public.fit_revisions x where x.fit_id = v_fit.id),
            1, v_snapshot, left(v_note, 500), 'AI reader')
    returning id into v_rev;
    -- A bowler with no sheet yet gets this one as current; otherwise the current sheet stays.
    if v_fit.current_revision_id is null then
      update public.fits set current_revision_id = v_rev, lock_version = lock_version + 1, label = v_snapshot ->> 'fit_label'
       where id = v_fit.id;
    end if;

    v_ext := coalesce(nullif(substring(v_item.object_path from '\.([a-z]+)$'), ''), 'jpg');
    insert into public.spec_photos (customer_id, shop_id, revision_id, object_path, store, original_filename, mime_type, size_bytes, caption, kind)
    values (v_customer, v_item.shop_id, v_rev, v_item.object_path, 'r2', 'paper-spec-sheet-front.' || v_ext,
            v_item.mime_type, v_item.size_bytes, 'Paper spec sheet, front (from the intake queue)', 'spec_sheet')
    returning id into v_front;
    if v_item.back_path is not null then
      v_ext := coalesce(nullif(substring(v_item.back_path from '\.([a-z]+)$'), ''), 'jpg');
      insert into public.spec_photos (customer_id, shop_id, revision_id, object_path, store, original_filename, mime_type, size_bytes, caption, kind)
      values (v_customer, v_item.shop_id, v_rev, v_item.back_path, 'r2', 'paper-spec-sheet-back.' || v_ext,
              v_item.mime_type, coalesce(v_item.back_size_bytes, v_item.size_bytes), 'Paper spec sheet, back (from the intake queue)', 'spec_sheet');
    end if;

    update public.intake_items
       set customer_id = v_customer, photo_id = v_front,
           read_sheet = read_sheet || jsonb_build_object('sheet_added', jsonb_build_object(
             'customer_id', v_customer, 'revision_id', v_rev, 'left_out', to_jsonb(v_left_out), 'at', now()))
     where id = p_id;
    return jsonb_build_object('id', p_id, 'added_to', v_customer, 'revision_id', v_rev, 'left_out', cardinality(v_left_out));
  exception when others then
    return jsonb_build_object('id', p_id, 'skipped', 'failed: ' || sqlerrm);
  end;
end;
$$;

revoke all on function private.add_ai_sheet_to_same_name(uuid) from public;
