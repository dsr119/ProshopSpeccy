-- A bowler's bowling balls: saved as a list, kept to their own shop.
begin;
select plan(9);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-00000000005a', 'Fictional Ball Bowler');
insert into public.shops (id, name) values ('00000000-0000-4000-8000-0000000005f0', 'Closed Ball Shop');
insert into public.customers (id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000005c2', '00000000-0000-4000-8000-0000000005f0', 'Fictional Closed Bowler');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is((select count(*) from public.save_bowling_balls('00000000-0000-4000-8000-0000000005c1',
  '[{"name": "Fictional One", "weight_lbs": "15", "layout": "4 1/2 x 4 x 2"}, {"name": "Fictional Two", "weight_lbs": 14}]'))::int, 2,
  'balls are saved in a list');
select is((select weight_lbs from public.bowling_balls where name = 'Fictional One'), 15::smallint, 'the weight is kept');

create temp table first_ball on commit drop as select id from public.bowling_balls where name = 'Fictional One';
grant select on first_ball to anon;
select is((select count(*) from public.save_bowling_balls('00000000-0000-4000-8000-0000000005c1',
  jsonb_build_array(jsonb_build_object('id', (select id from first_ball), 'name', 'Fictional One', 'layout', '5 x 5 x 3'))))::int, 1,
  'saving a shorter list removes the balls left out');
select is((select layout from public.bowling_balls where id = (select id from first_ball)), '5 x 5 x 3', 'a ball keeps its id when changed');
select is((select count(*) from public.bowling_balls where name = 'Fictional Two' and removed_at is not null)::int, 1, 'a ball taken off the list is kept, marked removed');

select throws_ok($$select * from public.save_bowling_balls('00000000-0000-4000-8000-0000000005c1', '[{"name": " "}]')$$,
  'PT422', 'Ball 1: give it a name', 'a ball needs a name');
select throws_ok($$select * from public.save_bowling_balls('00000000-0000-4000-8000-0000000005c1', '[{"name": "Heavy", "weight_lbs": 20}]')$$,
  'PT422', 'Ball 1: weight must be 6 to 16 lb', 'weights stay in the legal range');
select throws_ok($$select * from public.save_bowling_balls('00000000-0000-4000-8000-0000000005c2', '[{"name": "Elsewhere"}]')$$,
  'PT404', 'Customer not found', 'another shop''s bowler is out of reach');
select throws_ok($$insert into public.bowling_balls (customer_id, shop_id, name)
  values ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-00000000005a', 'Direct')$$,
  '42501', null, 'balls are only written through the save');

select * from finish();
rollback;
