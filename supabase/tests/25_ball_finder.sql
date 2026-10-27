-- The ball finder's list of spec sheet versions and its two date filters.
begin;
select plan(7);

create temp table t_result (label text primary key, value jsonb);
grant all on t_result to anon;

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.customers (shop_id, name, phone) values ('00000000-0000-4000-8000-00000000005a', 'Fictional Finder', '555 0199');
insert into t_result values ('r1', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Finder'), 0,
  '{"thumb_hole": {"entered": "1"}, "fitting_notes": "not returned"}'::jsonb));
insert into t_result values ('r2', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Finder'), 1, '{"thumb_hole": {"entered": "1 1/64"}}'::jsonb));

-- The first version came from a paper sheet dated in May (the file check is the storage trigger's job, tested elsewhere).
reset role;
alter table public.spec_photos disable trigger user;
insert into public.spec_photos (id, customer_id, shop_id, revision_id, object_path, mime_type, size_bytes, kind, sheet_date) values
  ('00000000-0000-4000-8000-0000000d0001', (select id from public.customers where name = 'Fictional Finder'),
   '00000000-0000-4000-8000-00000000005a', (select (value ->> 'revision_id')::uuid from t_result where label = 'r1'),
   'x/finder.jpg', 'image/jpeg', 1, 'spec_sheet', '2025-05-03');
alter table public.spec_photos enable trigger user;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*)::integer from public.ball_finder_sheets() where name = 'Fictional Finder'),
  2, 'every version of a bowler''s specs is listed');
select is(
  (select specs from public.ball_finder_sheets() where name = 'Fictional Finder' and revision_number = 1),
  '{"thumb_hole": {"d": 1, "n": 1, "entered": "1"}}'::jsonb, 'only fields that can be measured off a ball are returned');
select is(
  (select phone from public.ball_finder_sheets() where name = 'Fictional Finder' and is_current),
  '555 0199', 'the current version is marked, with the phone number');
select is(
  (select array_agg(sheet_date order by revision_number) from public.ball_finder_sheets() where name = 'Fictional Finder'),
  array['2025-05-03', '2025-05-03']::date[], 'a later edit keeps the date of the paper sheet it came from');
select is(
  (select count(*)::integer from public.ball_finder_sheets(p_paper_from => '2025-05-01', p_paper_to => '2025-05-31') where name = 'Fictional Finder'),
  2, 'the paper date filter finds the May sheet');
select is(
  (select count(*)::integer from public.ball_finder_sheets(p_paper_from => '2025-06-01') where name = 'Fictional Finder'),
  0, 'and leaves it out for other months');
select is(
  (select count(*)::integer from public.ball_finder_sheets(p_entered_from => now() + interval '1 day') where name = 'Fictional Finder'),
  0, 'the entered date filter uses when the version was saved');

select * from finish();
rollback;
