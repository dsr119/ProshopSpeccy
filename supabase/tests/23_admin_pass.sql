-- Admin can pass a sheet without a reason; everyone else picks one.
begin;
select plan(3);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.intake_items (id, shop_id, object_path, mime_type, size_bytes, store, added_by) values
  ('00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000004f1/original.jpg', 'image/jpeg', 300000, 'r2', 'Pat');

select throws_ok($$select public.pass_intake('00000000-0000-4000-8000-0000000004f1', null, null, 'Sam')$$,
  'PT422', 'Pick why you are passing this sheet', 'a reason is needed unless signed in as admin');

create temp table passed on commit drop as
  select public.pass_intake('00000000-0000-4000-8000-0000000004f1', null, null, 'Admin') as r;
grant select on passed to anon;

select is((select r -> 'passed' ->> 'status' from passed), 'unreadable', 'admin passes it to the passed pile');
select is((select r -> 'passed' ->> 'pass_reason' from passed), null, 'with no reason');

select * from finish();
rollback;
