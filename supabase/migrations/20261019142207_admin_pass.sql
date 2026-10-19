-- Admin can pass a sheet without picking a reason.

create or replace function public.pass_intake(p_id uuid, p_reason text, p_note text, p_name text)
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
  -- Signed in as admin, a sheet can be passed without a reason.
  if (p_reason is null and lower(trim(coalesce(p_name, ''))) <> 'admin')
     or p_reason not in ('too_blurry', 'dont_understand', 'too_sloppy', 'no_name', 'incomplete_specs', 'no_specs') then
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
