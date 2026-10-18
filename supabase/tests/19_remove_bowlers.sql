-- Removing bowlers and queue sheets hides them and can be undone.
begin;
select plan(10);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-00000000005a', 'Fictional Gone Bowler');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select public.remove_customer('00000000-0000-4000-8000-0000000006c1', 'Pat');
select is((select count(*) from public.customers where id = '00000000-0000-4000-8000-0000000006c1')::int, 0, 'a removed bowler is out of sight');
select is((select count(*) from public.search_customers('Fictional Gone'))::int, 0, 'and out of search');
select is((select removed_by from public.list_removed_customers() where id = '00000000-0000-4000-8000-0000000006c1'), 'Pat',
  'and listed as recently removed');
select public.restore_customer('00000000-0000-4000-8000-0000000006c1');
select is((select count(*) from public.customers where id = '00000000-0000-4000-8000-0000000006c1')::int, 1, 'bringing them back works');
update public.customers set removed_at = now() where id = '00000000-0000-4000-8000-0000000006c1';
select is((select count(*) from public.customers where id = '00000000-0000-4000-8000-0000000006c1')::int, 1,
  'the mark can''t be set by editing the bowler');

insert into public.intake_items (id, shop_id, object_path, mime_type, size_bytes, store, added_by) values
  ('00000000-0000-4000-8000-0000000006e1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000006e1/original.jpg', 'image/jpeg', 1000, 'r2', 'Pat');
select public.remove_intake('00000000-0000-4000-8000-0000000006e1', 'Sam');
select is((select count(*) from public.intake_items where id = '00000000-0000-4000-8000-0000000006e1')::int, 0, 'a removed sheet leaves the queue');
select ok((select (public.claim_next_intake('Sam')).id is distinct from '00000000-0000-4000-8000-0000000006e1'::uuid),
  'and is never handed out');
select is((select removed_by from public.list_removed_intake() where id = '00000000-0000-4000-8000-0000000006e1'), 'Sam',
  'and is listed as recently removed');
select public.restore_intake('00000000-0000-4000-8000-0000000006e1');
select is((select status from public.intake_items where id = '00000000-0000-4000-8000-0000000006e1'), 'waiting', 'a sheet can come back');

reset role;
update public.intake_items set status = 'done' where id = '00000000-0000-4000-8000-0000000006e1';
set local role anon;
select throws_ok($$select public.remove_intake('00000000-0000-4000-8000-0000000006e1', 'Sam')$$,
  'PT409', 'This sheet is already in the app. Remove the bowler instead.', 'typed-in sheets stay with their bowler');

select * from finish();
rollback;
