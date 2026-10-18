-- Photos whose files are in Cloudflare R2: who may get links, and how records point at them.
begin;
select plan(12);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-00000000005a', 'Fictional Cloud Bowler');
-- A customer of a shop that is not open.
insert into public.shops (id, name) values ('00000000-0000-4000-8000-0000000002f0', 'Closed Shop');
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000002c2', '00000000-0000-4000-8000-0000000002f0', 'Fictional Closed Bowler');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select ok(public.r2_keys_allowed(array[
  'spec-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002c1/00000000-0000-4000-8000-0000000002d1/original.jpg',
  'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/original.jpg'], 'put'),
  'the open shop can upload its own photos');
select ok(not public.r2_keys_allowed(array[
  'spec-photos/00000000-0000-4000-8000-0000000002f0/00000000-0000-4000-8000-0000000002c2/00000000-0000-4000-8000-0000000002d2/original.jpg'], 'get'),
  'another shop''s photos stay out of reach');
select ok(not public.r2_keys_allowed(array[
  'spec-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002c2/00000000-0000-4000-8000-0000000002d2/original.jpg'], 'get'),
  'the customer must belong to the shop in the path');
select ok(not public.r2_keys_allowed(array['intake-photos/00000000-0000-4000-8000-00000000005a/../x/original.jpg'], 'get'),
  'paths cannot climb out of their folder');
select ok(not public.r2_keys_allowed(array['other/00000000-0000-4000-8000-00000000005a/a/b.jpg'], 'get'), 'unknown folders are refused');
select ok(not public.r2_keys_allowed(array['intake-photos/x'], 'rename'), 'unknown actions are refused');

insert into public.intake_items (id, shop_id, object_path, mime_type, size_bytes, store, added_by) values
  ('00000000-0000-4000-8000-0000000002e1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/original.jpg', 'image/jpeg', 300000, 'r2', 'Pat');
select is((select size_bytes from public.intake_items where id = '00000000-0000-4000-8000-0000000002e1'), 300000::bigint,
  'a Cloudflare queue photo keeps its size');
select ok(not public.r2_keys_allowed(array['intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/original.jpg'], 'put'),
  'a file in use cannot be overwritten');
select ok(not public.r2_keys_allowed(array['intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/original.jpg'], 'delete'),
  'a file in use cannot be deleted');
select is((public.set_intake_back('00000000-0000-4000-8000-0000000002e1',
  'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/back-1.jpg', 250000)).back_path,
  'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/back-1.jpg', 'a Cloudflare sheet can have a back');

-- Typing the sheet in points the bowler's photo at the queue's file instead of copying it.
insert into public.spec_photos (customer_id, shop_id, object_path, mime_type, size_bytes, kind, store) values
  ('00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e1/original.jpg', 'image/jpeg', 300000, 'spec_sheet', 'r2');
select is((select count(*) from public.spec_photos where customer_id = '00000000-0000-4000-8000-0000000002c1')::int, 1,
  'the queue photo becomes the bowler''s spec sheet');
select throws_ok($$insert into public.spec_photos (customer_id, shop_id, object_path, mime_type, size_bytes, store) values
  ('00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000002e9/original.jpg', 'image/jpeg', 1, 'r2')$$,
  'PT422', 'Photo path does not match the customer', 'only a queued sheet''s file can be handed to a bowler');

select * from finish();
rollback;
