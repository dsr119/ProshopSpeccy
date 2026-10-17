-- Staff membership management. Accounts are created by inviting the person in
-- Supabase Auth; a shop administrator then grants (or removes) shop access here.
-- Having an account alone never grants access to customer data.

create or replace function public.admin_set_staff(
  p_shop_id uuid,
  p_email text,
  p_role text default 'staff',
  p_active boolean default true,
  p_display_name text default null
)
returns public.staff_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(p_email));
  v_row public.staff_memberships;
begin
  if not private.is_shop_admin(p_shop_id) then
    raise exception 'Only a shop administrator can manage staff' using errcode = 'PT403';
  end if;
  if p_role not in ('admin', 'staff') then
    raise exception 'Role must be admin or staff' using errcode = 'PT422';
  end if;

  select u.id into v_user_id from auth.users u where lower(u.email) = v_email;
  if v_user_id is null then
    raise exception 'No account uses % yet. Invite them from Supabase Auth first, then add them here.', v_email
      using errcode = 'PT404';
  end if;

  -- Keep at least one active administrator.
  if (p_role <> 'admin' or not p_active) and not exists (
    select 1 from public.staff_memberships m
     where m.shop_id = p_shop_id and m.role = 'admin' and m.active and m.user_id <> v_user_id
  ) then
    raise exception 'The shop needs at least one active administrator' using errcode = 'PT422';
  end if;

  insert into public.staff_memberships (shop_id, user_id, role, active, display_name, email)
  values (p_shop_id, v_user_id, p_role, p_active, nullif(trim(p_display_name), ''), v_email)
  on conflict (shop_id, user_id) do update
    set role = excluded.role,
        active = excluded.active,
        display_name = coalesce(excluded.display_name, public.staff_memberships.display_name),
        email = excluded.email,
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_set_staff(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.admin_set_staff(uuid, text, text, boolean, text) to authenticated;

-- One-time setup, run from the Supabase SQL editor (not callable from the app):
--   select private.bootstrap_shop('Your Pro Shop', 'owner@example.com', 'Owner Name');
-- The account must already exist (invite it under Authentication > Users first).
create or replace function private.bootstrap_shop(p_shop_name text, p_admin_email text, p_display_name text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shop_id uuid;
  v_user_id uuid;
begin
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(trim(p_admin_email));
  if v_user_id is null then
    raise exception 'No auth user with email %. Invite the user first.', p_admin_email;
  end if;

  select id into v_shop_id from public.shops where name = trim(p_shop_name);
  if v_shop_id is null then
    insert into public.shops (name) values (trim(p_shop_name)) returning id into v_shop_id;
  end if;

  insert into public.staff_memberships (shop_id, user_id, role, active, display_name, email)
  values (v_shop_id, v_user_id, 'admin', true, nullif(trim(p_display_name), ''), lower(trim(p_admin_email)))
  on conflict (shop_id, user_id) do update set role = 'admin', active = true, updated_at = now();

  return v_shop_id;
end;
$$;

revoke all on function private.bootstrap_shop(text, text, text) from public, anon, authenticated;
