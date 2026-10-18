-- Finishing a Cloudflare queue sheet in one call: photos to the bowler, done, and the next sheet taken.
begin;
select plan(7);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-00000000005a', 'Fictional Quick Bowler');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.intake_items (id, shop_id, object_path, mime_type, size_bytes, store, added_by) values
  ('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000003e1/original.jpg', 'image/jpeg', 300000, 'r2', 'Pat'),
  ('00000000-0000-4000-8000-0000000003e2', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000003e2/original.jpg', 'image/jpeg', 310000, 'r2', 'Pat');
select public.set_intake_back('00000000-0000-4000-8000-0000000003e1',
  'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000003e1/back-1.jpg', 250000);
select public.claim_next_intake('Sam');

create temp table finished on commit drop as
  select public.finish_intake('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003c1', null, 'Sam') as r;
grant select on finished to anon;

select is((select r -> 'done' ->> 'status' from finished), 'done', 'the sheet is marked done');
select is((select count(*) from public.spec_photos where customer_id = '00000000-0000-4000-8000-0000000003c1')::int, 2,
  'front and back become the bowler''s spec sheets');
select is((select size_bytes from public.spec_photos where object_path like '%/back-1.jpg'), 250000::bigint, 'the back keeps its own size');
select is((select r -> 'done' ->> 'photo_id' from finished)::uuid,
  (select id from public.spec_photos where object_path like '%3e1/original.jpg'), 'the queue entry points at the front');
select is((select r -> 'next' ->> 'id' from finished), '00000000-0000-4000-8000-0000000003e2', 'the next sheet comes back');
select is((select claimed_by from public.intake_items where id = '00000000-0000-4000-8000-0000000003e2'), 'Sam',
  'and is taken for the same person');
select throws_ok($$select public.finish_intake('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003c1', null, 'Sam')$$,
  'PT409', 'This sheet is already in the app', 'finishing twice is refused');

select * from finish();
rollback;
