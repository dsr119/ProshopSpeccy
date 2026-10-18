-- Confirming the digital spec sheet against the paper one.
begin;
select plan(6);

create temp table t_result (label text primary key, value jsonb);
grant all on t_result to anon;

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.customers (shop_id, name) values ('00000000-0000-4000-8000-00000000005a', 'Fictional Confirmer');
insert into t_result values ('r1', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Confirmer'), 0, '{"middle_hole": {"entered": "3/4"}}'::jsonb));

select throws_ok(
  format($$select public.set_fit_confirmed(%L, gen_random_uuid(), true)$$, (select value ->> 'fit_id' from t_result where label = 'r1')),
  'PT409', null, 'only the revision on screen can be confirmed');

insert into t_result values ('c1', public.set_fit_confirmed(
  (select (value ->> 'fit_id')::uuid from t_result where label = 'r1'),
  (select (value ->> 'revision_id')::uuid from t_result where label = 'r1'), true));
select is((select value ->> 'confirmed_by' from t_result where label = 'c1'), 'Shared link', 'confirming records who');
select ok((select value ->> 'confirmed_at' from t_result where label = 'c1') is not null, 'confirming records when');

insert into t_result values ('r2', public.save_fit_revision(
  (select id from public.customers where name = 'Fictional Confirmer'), 1, '{"middle_hole": {"entered": "7/8"}}'::jsonb));
select isnt(
  (select confirmed_revision_id from public.fits where id = (select (value ->> 'fit_id')::uuid from t_result where label = 'r2')),
  (select (value ->> 'revision_id')::uuid from t_result where label = 'r2'),
  'new measurements are not confirmed yet');

insert into t_result values ('c2', public.set_fit_confirmed(
  (select (value ->> 'fit_id')::uuid from t_result where label = 'r2'),
  (select (value ->> 'revision_id')::uuid from t_result where label = 'r2'), false));
select is((select value ->> 'confirmed_by' from t_result where label = 'c2'), null, 'confirmation can be turned off');

select throws_ok($$update public.fits set confirmed_by = 'someone'$$, '42501', null, 'confirmation only changes through the function');

reset role;
select * from finish();
rollback;
