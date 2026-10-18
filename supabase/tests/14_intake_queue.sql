-- The intake queue: photos of paper sheets taken one at a time and finished into the app.
begin;
select plan(12);

create temp table t_result (label text primary key, value jsonb);
grant all on t_result to anon;

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
-- Stand-ins for two uploaded photos.
insert into storage.objects (bucket_id, name, metadata) values
  ('intake-photos', '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000001e1/original.jpg', '{"mimetype": "image/jpeg", "size": 1000}'),
  ('intake-photos', '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000001e2/original.jpg', '{"mimetype": "image/jpeg", "size": 2000}');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok($$insert into public.intake_items (shop_id, object_path, mime_type, size_bytes)
  values ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000001e9/original.jpg', 'image/jpeg', 1)$$,
  'PT422', 'Uploaded file not found', 'a queue entry needs its uploaded photo');

insert into public.intake_items (shop_id, object_path, mime_type, size_bytes, added_by, status) values
  ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000001e1/original.jpg', 'image/png', 1, 'Pat', 'done');
insert into public.intake_items (shop_id, object_path, mime_type, size_bytes) values
  ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000001e2/original.jpg', 'image/jpeg', 1);
select is((select status from public.intake_items where added_by = 'Pat'), 'waiting', 'new photos always start in the queue');
select is((select size_bytes from public.intake_items where added_by = 'Pat'), 1000::bigint, 'size comes from the stored file');

insert into t_result values ('a', to_jsonb(public.claim_next_intake('Sam')));
insert into t_result values ('b', to_jsonb(public.claim_next_intake('Lee')));
insert into t_result values ('c', to_jsonb(public.claim_next_intake('Kim')));
select is((select value ->> 'added_by' from t_result where label = 'a'), 'Pat', 'the oldest photo comes first');
select isnt((select value ->> 'id' from t_result where label = 'b'), (select value ->> 'id' from t_result where label = 'a'),
  'two people never get the same sheet');
select is((select value ->> 'id' from t_result where label = 'c'), null, 'an empty queue gives nothing');

select is((public.release_intake((select (value ->> 'id')::uuid from t_result where label = 'b'))).status, 'waiting',
  'a sheet can be put back');
select is((public.release_intake((select (value ->> 'id')::uuid from t_result where label = 'b'), true, 'Faded')).note, 'Faded',
  'an unreadable sheet is set aside with a note');

insert into public.customers (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Fictional Backfill');
select is((public.complete_intake((select (value ->> 'id')::uuid from t_result where label = 'a'),
  (select id from public.customers where name = 'Fictional Backfill'), null, 'Sam')).status, 'done', 'a finished sheet is marked done');
select throws_ok(format($$select public.complete_intake(%L, %L, null, 'Sam')$$,
  (select value ->> 'id' from t_result where label = 'a'), (select id from public.customers where name = 'Fictional Backfill')),
  'PT409', 'This sheet is already in the app', 'a sheet is finished only once');
select throws_ok($$update public.intake_items set status = 'waiting'$$, '42501', null, 'the queue only changes through its functions');

reset role;
update public.shops set open_access = false where id = '00000000-0000-4000-8000-00000000005a';
set local role anon;
select is((select count(*)::int from public.intake_items), 0, 'a closed shop hides its queue');

reset role;
select * from finish();
rollback;
