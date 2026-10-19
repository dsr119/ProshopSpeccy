-- The grip choice, removing and restoring photos, and the dashboard's counts.
begin;
select plan(9);

select is(private.normalize_fit_snapshot('{"thumb_mode": "fingertip"}') ->> 'thumb_mode', 'fingertip', 'Finger Tip is a grip');
select is(private.normalize_fit_snapshot('{"thumb_mode": "thumb_in"}') ->> 'thumb_mode', 'thumb_in', 'older thumb-in fits still save');
select throws_ok($$select private.normalize_fit_snapshot('{"thumb_mode": "semi"}')$$,
  'PT422', 'Thumb mode: must be Finger Tip, Conventional or No Thumb', 'an unknown grip is refused');

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-00000000005a', 'Fictional Countbowler');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.spec_photos (id, customer_id, shop_id, object_path, store, mime_type, size_bytes, kind, caption)
  values ('00000000-0000-4000-8000-0000000006d1', '00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-00000000005a',
          'spec-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000006c1/00000000-0000-4000-8000-0000000006d1/original.jpg',
          'r2', 'image/jpeg', 1000, 'spec_sheet', 'Back of the sheet');
select public.save_bowling_balls('00000000-0000-4000-8000-0000000006c1', '[{"name": "Fictional Count Ball"}]');

select is((select spec_sheet_count from public.search_customers('Countbowler')), 0::bigint,
  'a photo of the paper sheet is not a digital spec sheet');
select is((select ball_count from public.search_customers('Countbowler')), 1::bigint, 'entered balls are counted');

select public.remove_photo('00000000-0000-4000-8000-0000000006d1', 'Pat');
select is((select count(*) from public.spec_photos where customer_id = '00000000-0000-4000-8000-0000000006c1')::int, 0,
  'a removed photo is no longer shown');
select throws_ok($$select public.remove_photo('00000000-0000-4000-8000-0000000006d1')$$,
  'PT404', 'Photo not found', 'it cannot be removed twice');
select public.restore_photo('00000000-0000-4000-8000-0000000006d1');
select is((select count(*) from public.spec_photos where customer_id = '00000000-0000-4000-8000-0000000006c1')::int, 1,
  'it can be brought back');

update public.spec_photos set removed_at = now() where id = '00000000-0000-4000-8000-0000000006d1';
select is((select count(*) from public.spec_photos where customer_id = '00000000-0000-4000-8000-0000000006c1')::int, 1,
  'the removed mark is only set through remove_photo');

select * from finish();
rollback;
