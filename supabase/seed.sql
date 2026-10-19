-- LOCAL DEVELOPMENT FIXTURES ONLY. Every person and record below is fictional.
-- This file runs on `supabase db reset` against the local stack. It is never
-- pushed to the hosted project by `supabase db push`.
--
-- Sign-ins (password for all: dev-password-123):
--   admin@example.test     shop administrator
--   staff@example.test     shop staff
--   staff2@example.test    shop staff (useful for testing edit conflicts)
--   outsider@example.test  has an account but no shop membership

do $$
declare
  v_users jsonb := '[
    {"id": "00000000-0000-4000-8000-0000000000a1", "email": "admin@example.test"},
    {"id": "00000000-0000-4000-8000-0000000000a2", "email": "staff@example.test"},
    {"id": "00000000-0000-4000-8000-0000000000a3", "email": "staff2@example.test"},
    {"id": "00000000-0000-4000-8000-0000000000a4", "email": "outsider@example.test"}
  ]';
  u jsonb;
begin
  for u in select * from jsonb_array_elements(v_users) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, phone_change, phone_change_token
    ) values (
      '00000000-0000-0000-0000-000000000000', (u ->> 'id')::uuid, 'authenticated', 'authenticated',
      u ->> 'email', extensions.crypt('dev-password-123', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
      '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), (u ->> 'id')::uuid, u ->> 'id', 'email',
      jsonb_build_object('sub', u ->> 'id', 'email', u ->> 'email', 'email_verified', true),
      now(), now(), now()
    );
  end loop;
end $$;

insert into public.shops (id, name)
values ('00000000-0000-4000-8000-00000000005a', 'Demo Lanes Pro Shop (fictional)');

-- Fictional names to pick from on the intake page.
insert into public.intake_names (shop_id, name) values
  ('00000000-0000-4000-8000-00000000005a', 'Fictional Fran'),
  ('00000000-0000-4000-8000-00000000005a', 'Fictional Pat');

insert into public.staff_memberships (shop_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-0000000000a1', 'admin', 'Alex Admin', 'admin@example.test'),
  ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-0000000000a2', 'staff', 'Sam Staff', 'staff@example.test'),
  ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-0000000000a3', 'staff', 'Riley Staff', 'staff2@example.test');

insert into public.customers (id, shop_id, name, phone, notes) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000005a', 'Fictional Pat Example', '(555) 010-0001', 'FICTIONAL test customer'),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-00000000005a', 'Fictional Pat Example', '(555) 010-0002', 'FICTIONAL test customer with the same name'),
  ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-00000000005a', 'Fictional Jordan Lefty', null, 'FICTIONAL left-handed no-thumb bowler');

-- A saved fit for the first customer, created through the same function the app uses.
do $$
begin
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
  perform public.save_fit_revision(
    '00000000-0000-4000-8000-0000000c0001', 0,
    '{
      "hand": "right", "thumb_mode": "thumb_in",
      "middle_hole": {"entered": "55/64"}, "ring_hole": {"entered": "53/64"}, "thumb_hole": {"entered": "1 1/16"},
      "middle_oval": "1/16 oval", "ring_oval": null, "thumb_oval": "1/32",
      "middle_lateral_pitch": {"entered": "1/8", "dir": "right"},
      "middle_fr_pitch": {"entered": "1/4", "dir": "forward"},
      "ring_lateral_pitch": {"entered": "0", "dir": "none"},
      "ring_fr_pitch": {"entered": "1/8", "dir": "forward"},
      "thumb_lateral_pitch": {"entered": "1/4", "dir": "left"},
      "thumb_fr_pitch": {"entered": "3/8", "dir": "reverse"},
      "middle_cut_to_cut": {"entered": "4 3/8"}, "ring_cut_to_cut": {"entered": "4 5/16"},
      "middle_actual_cut": {"entered": "4.5"}, "ring_actual_cut": {"entered": "4 7/16"},
      "thumb_oval_angle": {"entered": "15"},
      "finger_insert_details": "FICTIONAL: standard soft inserts",
      "thumb_system_details": "FICTIONAL: 1 inch urethane slug",
      "fitting_notes": "FICTIONAL sample record for development."
    }'::jsonb,
    'Initial fictional fixture'
  );
end $$;
