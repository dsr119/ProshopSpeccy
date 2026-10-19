-- Sheets the AI reader held back still get their bowler into the app when the
-- name is solid, so staff can work from the main page: find the bowler, check
-- the digital sheet against the paper photo, fix it, and mark it confirmed.
-- The sheet stays in the intake queue (linked to the bowler) until then;
-- confirming the bowler's spec sheet takes it out of the queue.
--
-- "Solid" = two separate AI reads (the name-and-phone pass and the full-sheet
-- pass) wrote the same name, and the full-sheet pass didn't mark it unsure.
-- The phone is kept only when the full-sheet pass didn't mark it unsure.
-- The specs go in as far as the app takes them: values it rejects are left
-- out and named in the change note, for staff to fill in from the photo.

create function private.add_ai_bowler(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  r jsonb;
  f jsonb;
  v_name text;
  v_phone text;
  v_digits text;
  v_span text;
  v_key text;
  v_kind text;
  v_text text;
  v_value jsonb;
  v_payload jsonb := '{}'::jsonb;
  v_left_out text[] := '{}';
  v_snapshot jsonb;
  v_match public.customers;
  v_customer uuid;
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
  if not coalesce(r -> 'unsure', '[]'::jsonb) ? 'phone' then
    v_phone := nullif(trim(coalesce(r ->> 'phone', '')), '');
  end if;
  v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');

  select * into v_match from public.customers c
   where c.shop_id = v_item.shop_id and c.removed_at is null
     and (c.name_search = lower(v_name) or (length(v_digits) >= 7 and c.phone_digits = v_digits))
   order by c.created_at
   limit 1;
  if found then
    return jsonb_build_object('id', p_id, 'skipped', 'already in the app: ' || v_match.name);
  end if;

  begin
    -- The reading in the app's shape, as private.file_ai_read builds it.
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
      -- Keep each value only if the sheet so far plus this value is still one the app takes.
      begin
        perform private.normalize_fit_snapshot(v_payload || jsonb_build_object(v_key, v_value));
        v_payload := v_payload || jsonb_build_object(v_key, v_value);
      exception when others then
        v_left_out := v_left_out || (v_key || ' "' || coalesce(f ->> 'written', v_text) || '"');
      end;
    end loop;
    v_snapshot := private.normalize_fit_snapshot(v_payload);

    v_note := 'AI reading, not checked yet: compare it with the paper photo';
    if cardinality(v_left_out) > 0 then
      v_note := v_note || '. Left out (the app would not take them): ' || array_to_string(v_left_out, ', ');
    end if;

    insert into public.customers (shop_id, name, phone)
    values (v_item.shop_id, v_name, v_phone)
    returning id into v_customer;
    insert into public.fits (customer_id, shop_id) values (v_customer, v_item.shop_id) returning * into v_fit;
    insert into public.fit_revisions (fit_id, shop_id, revision_number, schema_version, snapshot, change_note, author_name)
    values (v_fit.id, v_item.shop_id, 1, 1, v_snapshot, left(v_note, 500), 'AI reader')
    returning id into v_rev;
    update public.fits set current_revision_id = v_rev, lock_version = lock_version + 1, label = v_snapshot ->> 'fit_label'
     where id = v_fit.id;
    update public.customers set last_spec_at = now() where id = v_customer;

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

    -- The sheet stays waiting in the queue, now pointing at its bowler.
    update public.intake_items
       set customer_id = v_customer, photo_id = v_front,
           read_sheet = read_sheet || jsonb_build_object('bowler_added', jsonb_build_object(
             'customer_id', v_customer, 'revision_id', v_rev, 'left_out', to_jsonb(v_left_out), 'at', now()))
     where id = p_id;
    return jsonb_build_object('id', p_id, 'added', v_customer, 'left_out', cardinality(v_left_out));
  exception when others then
    return jsonb_build_object('id', p_id, 'skipped', 'failed: ' || sqlerrm);
  end;
end;
$$;

revoke all on function private.add_ai_bowler(uuid) from public;

-- Confirming a bowler's spec sheet in the app takes that bowler's sheets out of
-- the intake queue (marked done by whoever confirmed it). Sheets someone has
-- open stay as they are.
create function private.fits_confirm_clears_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.confirmed_revision_id is not null and new.confirmed_revision_id is distinct from old.confirmed_revision_id then
    update public.intake_items
       set status = 'done', done_by = left(coalesce(new.confirmed_by, 'Confirmed in the app'), 120), done_at = now()
     where customer_id = new.customer_id and status = 'waiting' and removed_at is null;
  end if;
  return new;
end;
$$;

create trigger fits_confirm_clears_queue
after update of confirmed_revision_id on public.fits
for each row execute function private.fits_confirm_clears_queue();

-- Finishing a queued sheet through intake when its photos were already given
-- to a bowler (above): the same bowler keeps them, with no second copy. If the
-- person picks a different bowler, the photos move to that bowler, and the
-- bowler the AI made from this sheet is removed if nobody confirmed it.
-- Moving a photo is allowed only from finish_intake, via a setting the stamp
-- trigger checks.
create or replace function private.spec_photos_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object record;
  v_moving boolean := tg_op = 'UPDATE' and coalesce(current_setting('proshop.move_intake_photo', true), '') = 'on';
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
    -- Only caption, rotation, kind and the confirmed mark can change after upload
    -- (and the bowler, when finish_intake moves a queued sheet's photo).
    new.id := old.id;
    if not (v_moving and old.object_path like 'intake-photos/%') then
      new.customer_id := old.customer_id;
      new.revision_id := old.revision_id;
    elsif new.revision_id is not null and not exists (
      select 1 from public.fit_revisions r join public.fits f on f.id = r.fit_id
       where r.id = new.revision_id and f.customer_id = new.customer_id
    ) then
      raise exception 'Revision belongs to a different customer' using errcode = 'PT422';
    end if;
    new.shop_id := old.shop_id;
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

create or replace function public.finish_intake(p_id uuid, p_customer_id uuid, p_revision_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  v_next public.intake_items;
  v_front uuid;
  v_owner uuid;
  v_ext text;
  v_ai_bowler uuid;
begin
  select * into v_item from public.intake_items where id = p_id for update;
  if not found or not private.is_shop_member(v_item.shop_id) then
    raise exception 'Queue item not found' using errcode = 'PT404';
  end if;
  if v_item.status = 'done' then
    raise exception 'This sheet is already in the app' using errcode = 'PT409';
  end if;
  if v_item.store <> 'r2' then
    raise exception 'This sheet''s photos are stored the old way' using errcode = 'PT422';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = v_item.shop_id) then
    raise exception 'Customer not found' using errcode = 'PT404';
  end if;

  select p.id, p.customer_id into v_front, v_owner from public.spec_photos p where p.object_path = v_item.object_path;
  if v_front is null then
    -- spec_photos_stamp checks the path and the revision, and fills the author.
    v_ext := coalesce(nullif(substring(v_item.object_path from '\.([a-z]+)$'), ''), 'jpg');
    insert into public.spec_photos (customer_id, shop_id, revision_id, object_path, store, original_filename, mime_type, size_bytes, caption, kind)
    values (p_customer_id, v_item.shop_id, p_revision_id, v_item.object_path, 'r2', 'paper-spec-sheet-front.' || v_ext,
            v_item.mime_type, v_item.size_bytes, 'Paper spec sheet, front (from the intake queue)', 'spec_sheet')
    returning id into v_front;
    if v_item.back_path is not null then
      v_ext := coalesce(nullif(substring(v_item.back_path from '\.([a-z]+)$'), ''), 'jpg');
      insert into public.spec_photos (customer_id, shop_id, revision_id, object_path, store, original_filename, mime_type, size_bytes, caption, kind)
      values (p_customer_id, v_item.shop_id, p_revision_id, v_item.back_path, 'r2', 'paper-spec-sheet-back.' || v_ext,
              v_item.mime_type, coalesce(v_item.back_size_bytes, v_item.size_bytes), 'Paper spec sheet, back (from the intake queue)', 'spec_sheet');
    end if;
  elsif v_owner <> p_customer_id then
    perform set_config('proshop.move_intake_photo', 'on', true);
    update public.spec_photos
       set customer_id = p_customer_id, revision_id = p_revision_id
     where object_path in (v_item.object_path, v_item.back_path);
    perform set_config('proshop.move_intake_photo', '', true);
    -- The bowler the AI made from this sheet was the wrong person: remove it unless someone confirmed it.
    v_ai_bowler := (v_item.read_sheet -> 'bowler_added' ->> 'customer_id')::uuid;
    if v_ai_bowler = v_owner and not exists (
      select 1 from public.fits f where f.customer_id = v_owner and f.confirmed_revision_id is not null
    ) then
      update public.customers
         set removed_at = now(), removed_by = 'Intake: the sheet was another bowler'
       where id = v_owner and removed_at is null;
    end if;
  end if;

  update public.intake_items
     set status = 'done', customer_id = p_customer_id, photo_id = v_front,
         done_by = left(nullif(trim(p_name), ''), 120), done_at = now()
   where id = p_id
   returning * into v_item;

  v_next := public.claim_next_intake(p_name);
  return jsonb_build_object('done', to_jsonb(v_item), 'next', case when v_next.id is null then null else to_jsonb(v_next) end);
end;
$$;
