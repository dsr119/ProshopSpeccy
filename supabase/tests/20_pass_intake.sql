-- Passing a sheet with a reason, and the longer list of grip types.
begin;
select plan(9);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.intake_items (id, shop_id, object_path, mime_type, size_bytes, store, added_by) values
  ('00000000-0000-4000-8000-0000000004e1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000004e1/original.jpg', 'image/jpeg', 300000, 'r2', 'Pat'),
  ('00000000-0000-4000-8000-0000000004e2', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000004e2/original.jpg', 'image/jpeg', 310000, 'r2', 'Pat');
select public.claim_next_intake('Sam');

select throws_ok($$select public.pass_intake('00000000-0000-4000-8000-0000000004e1', 'smudged', null, 'Sam')$$,
  'PT422', 'Pick why you are passing this sheet', 'an unknown reason is refused');

create temp table passed on commit drop as
  select public.pass_intake('00000000-0000-4000-8000-0000000004e1', 'incomplete_specs', '  Ring span missing ', 'Sam') as r;
grant select on passed to anon;

select is((select r -> 'passed' ->> 'status' from passed), 'unreadable', 'the sheet goes to the passed pile');
select is((select r -> 'passed' ->> 'pass_reason' from passed), 'incomplete_specs', 'with its reason');
select is((select r -> 'passed' ->> 'note' from passed), 'Ring span missing', 'and the trimmed note');
select is((select r -> 'passed' ->> 'passed_by' from passed), 'Sam', 'and who passed it');
select is((select r -> 'passed' ->> 'claimed_by' from passed), null, 'nobody holds it any more');
select is((select r -> 'next' ->> 'id' from passed), '00000000-0000-4000-8000-0000000004e2', 'the next sheet comes back for the same person');

reset role;
select is(private.normalize_fit_snapshot('{"finger_grips": "grips", "grip_type": "oval_no_mesh"}') ->> 'grip_type',
  'oval_no_mesh', 'oval no mesh is a grip type');
select throws_ok($$select private.normalize_fit_snapshot('{"finger_grips": "grips", "grip_type": "mesh"}')$$,
  'PT422', 'Grip type: must be STD, Vaccu, Oval Mesh, Oval No Mesh or Lifts', 'an unknown grip type is refused');

select * from finish();
rollback;
