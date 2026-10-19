-- Files a sheet the AI reader is confident about straight into the app: a new
-- bowler with the sheet's specs as their digital spec sheet, and the paper
-- photos (front, and back when there is one) in their Photos. The queue entry
-- is marked done by "AI reader". Anything less certain stays in the queue for
-- a person, with the reason saved on read_sheet.filing.
--
-- Held when: the reading is missing or failed, its confidence is under p_min,
-- no name was read, the app would not take a value, or a bowler with the same
-- name or phone is already in the app (so two paper sheets for one bowler, or
-- a possible duplicate, always get a person's eye).
--
-- Run from SQL only (not exposed to the app):
--   select private.file_ai_read(id) from public.intake_items where ...;

create function private.file_ai_read(p_id uuid, p_min integer default 80)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  r jsonb;
  f jsonb;
  v_conf integer;
  v_name text;
  v_phone text;
  v_digits text;
  v_span text;
  v_key text;
  v_kind text;
  v_text text;
  v_payload jsonb := '{}'::jsonb;
  v_snapshot jsonb;
  v_reason text;
  v_match public.customers;
  v_customer uuid;
  v_fit public.fits;
  v_rev uuid;
  v_front uuid;
  v_ext text;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or v_item.removed_at is not null or v_item.status <> 'waiting' or v_item.store <> 'r2' then
    return jsonb_build_object('id', p_id, 'skipped', coalesce(v_item.status, 'not found'));
  end if;

  r := v_item.read_sheet;
  if r is null or coalesce((r ->> 'v')::integer, 0) < 3 then
    return jsonb_build_object('id', p_id, 'skipped', 'not read yet');
  end if;

  begin
    v_conf := (r ->> 'confidence')::integer;
    v_name := regexp_replace(trim(coalesce(r ->> 'name', '')), '\s+', ' ', 'g');
    v_phone := nullif(trim(coalesce(r ->> 'phone', '')), '');
    v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');

    if r ? 'error' then
      v_reason := 'The AI could not read this sheet';
    elsif v_conf is null or v_conf < p_min then
      v_reason := format('The AI was %s%% sure', coalesce(v_conf::text, 'not'));
    elsif v_name = '' then
      v_reason := 'No name was read';
    end if;

    -- The reading's values, in the app's shape. The two spans go under the span type the sheet shows.
    if v_reason is null then
      select coalesce(max(e ->> 'text') filter (where e ->> 'text' in ('cut_to_cut', 'full_span', 'cut_to_outer')), 'cut_to_cut')
        into v_span
        from jsonb_array_elements(r -> 'fields') e
       where e ->> 'key' = 'span_type';
      for f in select * from jsonb_array_elements(r -> 'fields') loop
        v_key := f ->> 'key';
        v_text := nullif(trim(f ->> 'text'), '');
        if v_key in ('middle_span', 'ring_span') then
          v_key := split_part(v_key, '_', 1) || '_' || v_span;
        end if;
        select k.kind into v_kind from private.fit_field_kinds() k where k.key = v_key;
        if v_kind is null or v_text is null then
          continue;
        end if;
        if v_key in ('middle_inserts', 'ring_inserts') and v_text not in ('Oval Mesh', 'Oval No Mesh', 'Lifts') then
          v_reason := format('Inserts "%s" is not one of the app''s choices', v_text);
        elsif v_key in ('middle_grip_brand', 'ring_grip_brand') and v_text not in ('Turbo', 'Vise', 'Other') then
          v_reason := format('Grip brand "%s" is not one of the app''s choices', v_text);
        end if;
        v_payload := v_payload || jsonb_build_object(v_key,
          case
            when v_kind in ('enum_hand', 'enum_thumb_mode', 'enum_span_type', 'enum_thumb_insert', 'enum_grips',
                            'enum_grip_type', 'enum_play_style', 'text_short', 'text_long') then to_jsonb(v_text)
            when v_kind in ('pitch_lateral', 'pitch_fr', 'pitch_ud') then
              jsonb_strip_nulls(jsonb_build_object('entered', v_text, 'dir', nullif(trim(f ->> 'dir'), '')))
            else jsonb_build_object('entered', v_text)
          end);
      end loop;
      v_payload := v_payload || jsonb_build_object('span_type', v_span);
    end if;

    if v_reason is null then
      begin
        v_snapshot := private.normalize_fit_snapshot(v_payload);
      exception when others then
        v_reason := 'The app would not take a value: ' || sqlerrm;
      end;
    end if;

    -- Same name or phone as a bowler already in the app: a person decides.
    if v_reason is null then
      select * into v_match from public.customers c
       where c.shop_id = v_item.shop_id and c.removed_at is null
         and (c.name_search = lower(v_name) or (length(v_digits) >= 7 and c.phone_digits = v_digits))
       order by c.created_at
       limit 1;
      if found then
        v_reason := format('%s is already in the app (%s)', v_match.name,
          case when v_match.name_search = lower(v_name) then 'same name' else 'same phone' end);
      end if;
    end if;

    if v_reason is not null then
      update public.intake_items
         set read_sheet = read_sheet || jsonb_build_object('filing', jsonb_build_object('held', v_reason, 'at', now()))
       where id = p_id;
      return jsonb_build_object('id', p_id, 'held', v_reason);
    end if;

    insert into public.customers (shop_id, name, phone)
    values (v_item.shop_id, v_name, v_phone)
    returning id into v_customer;

    insert into public.fits (customer_id, shop_id) values (v_customer, v_item.shop_id) returning * into v_fit;
    insert into public.fit_revisions (fit_id, shop_id, revision_number, schema_version, snapshot, change_note, author_name)
    values (v_fit.id, v_item.shop_id, 1, 1, v_snapshot,
            format('Read from the paper sheet by the AI reader (%s%% sure)', v_conf), 'AI reader')
    returning id into v_rev;
    update public.fits set current_revision_id = v_rev, lock_version = lock_version + 1, label = v_snapshot ->> 'fit_label'
     where id = v_fit.id;
    update public.customers set last_spec_at = now() where id = v_customer;

    -- The paper photos, shared with the queue's files as finish_intake does.
    v_ext := coalesce(nullif(substring(v_item.object_path from '\.([a-z]+)$'), ''), 'jpg');
    insert into public.spec_photos (customer_id, shop_id, revision_id, object_path, store, original_filename, mime_type, size_bytes, caption, kind)
    values (v_customer, v_item.shop_id, v_rev, v_item.object_path, 'r2', 'paper-spec-sheet-front.' || v_ext,
            v_item.mime_type, v_item.size_bytes, 'Paper spec sheet, front (filed by the AI reader)', 'spec_sheet')
    returning id into v_front;
    if v_item.back_path is not null then
      v_ext := coalesce(nullif(substring(v_item.back_path from '\.([a-z]+)$'), ''), 'jpg');
      insert into public.spec_photos (customer_id, shop_id, revision_id, object_path, store, original_filename, mime_type, size_bytes, caption, kind)
      values (v_customer, v_item.shop_id, v_rev, v_item.back_path, 'r2', 'paper-spec-sheet-back.' || v_ext,
              v_item.mime_type, coalesce(v_item.back_size_bytes, v_item.size_bytes), 'Paper spec sheet, back (filed by the AI reader)', 'spec_sheet');
    end if;

    update public.intake_items
       set status = 'done', customer_id = v_customer, photo_id = v_front, done_by = 'AI reader', done_at = now(),
           read_sheet = read_sheet || jsonb_build_object('filing', jsonb_build_object(
             'filed', true, 'customer_id', v_customer, 'revision_id', v_rev, 'at', now()))
     where id = p_id;
    return jsonb_build_object('id', p_id, 'filed', v_customer);
  exception when others then
    -- Anything unexpected undoes this sheet's filing and leaves it for a person.
    update public.intake_items
       set read_sheet = read_sheet || jsonb_build_object('filing', jsonb_build_object('held', 'Filing failed: ' || sqlerrm, 'at', now()))
     where id = p_id;
    return jsonb_build_object('id', p_id, 'held', 'Filing failed: ' || sqlerrm);
  end;
end;
$$;

revoke all on function private.file_ai_read(uuid, integer) from public;
