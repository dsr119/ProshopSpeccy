-- The intake sign-in list: members see it and can add names; duplicates and "admin" are refused.
begin;
select plan(5);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select ok((select count(*) from public.intake_names where name = 'Fictional Fran') = 1, 'the seeded names can be read');
select is((public.add_intake_name('00000000-0000-4000-8000-00000000005a', '  Fictional   Quinn ')).name, 'Fictional Quinn',
  'a new name is added, tidied');
select throws_ok($$select public.add_intake_name('00000000-0000-4000-8000-00000000005a', 'fictional quinn')$$,
  'PT409', 'fictional quinn is already on the list', 'the same name twice is refused');
select throws_ok($$select public.add_intake_name('00000000-0000-4000-8000-00000000005a', 'Admin')$$,
  'PT422', 'Admin is already on the list', 'admin is not added as a name');
select throws_ok($$insert into public.intake_names (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Sneaky')$$,
  '42501', null, 'names are only added through add_intake_name');

select * from finish();
rollback;
