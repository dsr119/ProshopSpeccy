-- The digital spec sheet can be marked as checked against the paper sheet.
-- The mark belongs to one revision: saving new measurements leaves the new
-- revision unconfirmed until someone confirms it again.

alter table public.fits
  add column confirmed_revision_id uuid references public.fit_revisions (id),
  add column confirmed_at timestamptz,
  add column confirmed_by text;

create function public.set_fit_confirmed(p_fit_id uuid, p_revision_id uuid, p_confirmed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fit public.fits;
begin
  select * into v_fit from public.fits where id = p_fit_id for update;
  if not found or not private.is_shop_member(v_fit.shop_id) then
    raise exception 'Spec sheet not found' using errcode = 'PT404';
  end if;
  if v_fit.current_revision_id is distinct from p_revision_id then
    raise exception 'The spec sheet was changed since you opened it. Reload to see the latest before confirming.'
      using errcode = 'PT409';
  end if;

  if p_confirmed then
    update public.fits
       set confirmed_revision_id = p_revision_id,
           confirmed_at = now(),
           confirmed_by = private.staff_display_name(v_fit.shop_id, auth.uid())
     where id = p_fit_id
     returning * into v_fit;
  else
    update public.fits
       set confirmed_revision_id = null, confirmed_at = null, confirmed_by = null
     where id = p_fit_id
     returning * into v_fit;
  end if;

  return jsonb_build_object(
    'confirmed_revision_id', v_fit.confirmed_revision_id,
    'confirmed_at', v_fit.confirmed_at,
    'confirmed_by', v_fit.confirmed_by
  );
end;
$$;

revoke all on function public.set_fit_confirmed(uuid, uuid, boolean) from public;
grant execute on function public.set_fit_confirmed(uuid, uuid, boolean) to anon, authenticated;
