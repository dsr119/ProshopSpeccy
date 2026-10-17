-- Open-link mode: with open_access on, signed-out visitors can use the shop
-- without signing in, but history stays immutable and admin actions stay closed.
begin;
select plan(13);

create temp table t_result (label text primary key, value jsonb);
grant all on t_result to anon;

-- Off by default: the access-control tests cover the closed shop.
select is((select open_access from public.shops where id = '00000000-0000-4000-8000-00000000005a'), false,
  'shops are closed unless turned on');

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is((select count(*)::int from public.shops), 1, 'anyone can see the open shop');
select ok((select count(*) from public.customers) >= 3, 'anyone can see customers');
select ok((select count(*) from public.search_customers('pat')) >= 1, 'anyone can search');

insert into public.customers (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Fictional Walk-in');
select is((select created_by from public.customers where name = 'Fictional Walk-in'), null::uuid,
  'customers added from the link have no account');

insert into t_result values ('save', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Walk-in'), 0, '{"middle_hole": {"entered": "3/4"}}'::jsonb));
select is((select (value ->> 'revision_number')::int from t_result where label = 'save'), 1, 'anyone can save a fit');
select is(
  (select author_name from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'save')),
  'Shared link', 'saves from the link are labelled as such');

select throws_ok($$update public.fit_revisions set change_note = 'tampered'$$, '42501', null, 'history cannot be edited');
select throws_ok($$delete from public.customers$$, '42501', null, 'customers cannot be deleted');
select throws_ok($$select count(*) from public.staff_memberships$$, '42501', null, 'staff list stays private');
select throws_ok(
  $$select public.admin_set_staff('00000000-0000-4000-8000-00000000005a', 'outsider@example.test', 'admin', true)$$,
  '42501', null, 'staff management stays closed');
select throws_ok($$update public.shops set open_access = false$$, '42501', null, 'the link cannot change shop settings');

reset role;
update public.shops set open_access = false where id = '00000000-0000-4000-8000-00000000005a';
set local role anon;
select is((select count(*)::int from public.customers), 0, 'turning it off closes the shop again');

reset role;
select * from finish();
rollback;
