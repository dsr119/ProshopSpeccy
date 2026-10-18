-- Saving a typed-in sheet in one trip: its photos (front, and back when there
-- is one) become spec sheets in the bowler's Photos, the queue entry is marked
-- done, and the next sheet is taken for the same person. Only for sheets whose
-- files are in Cloudflare R2, where the bowler's records point at the same
-- files; Supabase Storage sheets still copy their files from the browser.

create function public.finish_intake(p_id uuid, p_customer_id uuid, p_revision_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_items;
  v_next public.intake_items;
  v_front uuid;
  v_ext text;
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

  update public.intake_items
     set status = 'done', customer_id = p_customer_id, photo_id = v_front,
         done_by = left(nullif(trim(p_name), ''), 120), done_at = now()
   where id = p_id
   returning * into v_item;

  v_next := public.claim_next_intake(p_name);
  return jsonb_build_object('done', to_jsonb(v_item), 'next', case when v_next.id is null then null else to_jsonb(v_next) end);
end;
$$;

revoke all on function public.finish_intake(uuid, uuid, uuid, text) from public;
grant execute on function public.finish_intake(uuid, uuid, uuid, text) to anon, authenticated;
