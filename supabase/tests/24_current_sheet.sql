-- Picking the current digital version and the current paper sheet photo.
begin;
select plan(9);

create temp table t_result (label text primary key, value jsonb);
grant all on t_result to anon;

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.customers (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Fictional Current');
insert into public.customers (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Fictional Other');
insert into t_result values ('r1', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Current'), 0, '{"middle_hole": {"entered": "3/4"}}'::jsonb));
insert into t_result values ('r2', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Current'), 1, '{"middle_hole": {"entered": "7/8"}}'::jsonb));

select throws_ok(
  format($$select public.set_current_revision(%L, 0)$$, (select value ->> 'revision_id' from t_result where label = 'r1')),
  'PT409', null, 'switching needs the lock version on screen');

insert into t_result values ('s1', public.set_current_revision((select (value ->> 'revision_id')::uuid from t_result where label = 'r1'), 2));
select is(
  (select current_revision_id from public.fits where id = (select (value ->> 'fit_id')::uuid from t_result where label = 'r1')),
  (select (value ->> 'revision_id')::uuid from t_result where label = 'r1'),
  'an older version can be made current');
select is((select count(*)::integer from public.fit_revisions where fit_id = (select (value ->> 'fit_id')::uuid from t_result where label = 'r1')),
  2, 'making a version current copies nothing');
select is((select (value ->> 'lock_version')::integer from t_result where label = 's1'), 3, 'switching bumps the lock version');

-- Photos are recorded straight in the table here (the file check is the storage trigger's job, tested elsewhere).
reset role;
alter table public.spec_photos disable trigger user;
insert into public.spec_photos (id, customer_id, shop_id, object_path, mime_type, size_bytes, kind) values
  ('00000000-0000-4000-8000-0000000c0001', (select id from public.customers where name = 'Fictional Current'),
   '00000000-0000-4000-8000-00000000005a', 'x/sheet.jpg', 'image/jpeg', 1, 'spec_sheet'),
  ('00000000-0000-4000-8000-0000000c0002', (select id from public.customers where name = 'Fictional Current'),
   '00000000-0000-4000-8000-00000000005a', 'x/ball.jpg', 'image/jpeg', 1, 'ball');
alter table public.spec_photos enable trigger user;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select public.set_current_photo('00000000-0000-4000-8000-0000000c0001',
  (select (value ->> 'revision_id')::uuid from t_result where label = 'r2'));
select is((select current_photo_id from public.customers where name = 'Fictional Current'),
  '00000000-0000-4000-8000-0000000c0001'::uuid, 'a spec sheet photo can be the current paper sheet');
select is((select imported_revision_id from public.spec_photos where id = '00000000-0000-4000-8000-0000000c0001'),
  (select (value ->> 'revision_id')::uuid from t_result where label = 'r2'), 'the imported version is linked to the photo');

select throws_ok($$select public.set_current_photo('00000000-0000-4000-8000-0000000c0002')$$,
  'PT422', null, 'a ball picture cannot be the current paper sheet');

insert into t_result values ('o1', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Other'), 0, '{"middle_hole": {"entered": "1/2"}}'::jsonb));
select throws_ok(
  format($$select public.set_current_photo('00000000-0000-4000-8000-0000000c0001', %L)$$, (select value ->> 'revision_id' from t_result where label = 'o1')),
  'PT422', null, 'a photo cannot be linked to another bowler''s version');

select throws_ok($$select public.set_current_photo(gen_random_uuid())$$, 'PT404', null, 'unknown photos are refused');

reset role;
select * from finish();
rollback;
