-- Signed-out users and accounts without an active shop membership cannot read
-- or change customers, fits, revisions or photos, through tables or functions.
begin;
select plan(30);

-- A photo object and metadata to probe, created as the database owner.
insert into storage.objects (bucket_id, name, metadata)
values ('spec-photos', '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0001/11111111-1111-4111-8111-111111111111/original.jpg',
        '{"mimetype": "image/jpeg", "size": 1234}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
insert into public.spec_photos (id, customer_id, shop_id, object_path, mime_type, size_bytes)
values ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000005a',
        '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0001/11111111-1111-4111-8111-111111111111/original.jpg',
        'image/jpeg', 1234);
reset role;

------------------------------------------------------------------------------
-- Signed out (anon)
------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok('select count(*) from public.customers', '42501', null, 'anon cannot read customers');
select throws_ok('select count(*) from public.fit_revisions', '42501', null, 'anon cannot read revisions');
select throws_ok('select count(*) from public.spec_photos', '42501', null, 'anon cannot read photo records');
select throws_ok($$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0001', 1, '{}'::jsonb)$$, '42501', null,
  'anon cannot call save');
select throws_ok($$select * from public.search_customers('pat')$$, '42501', null, 'anon cannot search');
select is((select count(*)::int from storage.objects where bucket_id = 'spec-photos'), 0, 'anon cannot see photo files');

reset role;

------------------------------------------------------------------------------
-- Signed in, but not a member of the shop
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated"}', true);

select is((select count(*)::int from public.customers), 0, 'nonmember sees no customers');
select is((select count(*)::int from public.search_customers('pat')), 0, 'nonmember search returns nothing');
select is((select count(*)::int from public.fits), 0, 'nonmember sees no fits');
select is((select count(*)::int from public.fit_revisions), 0, 'nonmember sees no revisions');
select is((select count(*)::int from public.spec_photos), 0, 'nonmember sees no photo records');
select is((select count(*)::int from public.shops), 0, 'nonmember sees no shops');
select is((select count(*)::int from storage.objects where bucket_id = 'spec-photos'), 0, 'nonmember cannot see photo files');
select throws_ok(
  $$insert into public.customers (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Intruder')$$,
  '42501', null, 'nonmember cannot add customers to the shop');
select is_empty(
  $$update public.customers set name = 'Changed' where id = '00000000-0000-4000-8000-0000000c0001' returning id$$,
  'nonmember cannot edit customers');
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0001', 1, '{"middle_hole": {"entered": "1"}}'::jsonb)$$,
  'PT404', 'Customer not found', 'nonmember cannot save a fit even with a guessed customer id');
select throws_ok(
  $$select public.restore_fit_revision((select id from public.fit_revisions limit 1), 1)$$,
  'PT404', null, 'nonmember cannot restore');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('spec-photos',
    '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0001/22222222-2222-4222-8222-222222222222/original.jpg')$$,
  '42501', null, 'nonmember cannot upload into the shop folder');
select throws_ok(
  $$select public.admin_set_staff('00000000-0000-4000-8000-00000000005a', 'outsider@example.test', 'admin', true)$$,
  'PT403', null, 'nonmember cannot grant themselves access');

reset role;

------------------------------------------------------------------------------
-- Active staff member
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);

select ok((select count(*) from public.customers) >= 3, 'member sees shop customers');
select ok((select count(*) from storage.objects where bucket_id = 'spec-photos') >= 1, 'member can see shop photo files');
select throws_ok(
  $$insert into public.fit_revisions (fit_id, shop_id, revision_number, snapshot, author_id)
    select id, shop_id, 99, '{}'::jsonb, '00000000-0000-4000-8000-0000000000a2' from public.fits limit 1$$,
  '42501', null, 'member cannot insert revisions directly');
select throws_ok($$update public.fit_revisions set change_note = 'tampered'$$, '42501', null, 'member cannot edit revisions');
select throws_ok($$delete from public.fit_revisions$$, '42501', null, 'member cannot delete revisions');
select throws_ok($$update public.fits set lock_version = 0$$, '42501', null, 'member cannot update fits directly');
select throws_ok($$delete from public.customers$$, '42501', null, 'member cannot delete customers');
select throws_ok(
  $$select public.admin_set_staff('00000000-0000-4000-8000-00000000005a', 'outsider@example.test', 'staff', true)$$,
  'PT403', null, 'staff (non-admin) cannot manage memberships');

-- Author and shop come from the identity, not the client.
insert into public.customers (shop_id, name, created_by)
values ('00000000-0000-4000-8000-00000000005a', 'Fictional New Person', '00000000-0000-4000-8000-0000000000a1');
select is((select created_by from public.customers where name = 'Fictional New Person'),
  '00000000-0000-4000-8000-0000000000a2'::uuid, 'created_by is the signed-in staff member');

reset role;

-- Database-level: revisions are immutable even for the owner.
select throws_ok($$update public.fit_revisions set change_note = 'x'$$, 'PT403', null, 'revision rows are immutable');

-- Deactivated staff lose access immediately.
update public.staff_memberships set active = false where user_id = '00000000-0000-4000-8000-0000000000a3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}', true);
select is((select count(*)::int from public.customers), 0, 'deactivated staff see no customers');
reset role;

select * from finish();
rollback;
