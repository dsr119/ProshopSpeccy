-- P.A.P horizontal and vertical, and the sorted customer list.
begin;
select plan(5);

select is(private.normalize_fit_snapshot('{"pap_horizontal": {"entered": "5 1/2"}, "pap_vertical": {"entered": "1/2", "dir": "up"}}') -> 'pap_vertical' ->> 'dir',
  'up', 'vertical P.A.P keeps up or down');
select throws_ok($$select private.normalize_fit_snapshot('{"pap_vertical": {"entered": "1/2", "dir": "left"}}')$$,
  'PT422', 'P.A.P vertical: direction must be up or down', 'vertical P.A.P is up or down');
select throws_ok($$select private.normalize_fit_snapshot('{"pap_horizontal": {"entered": "8 1/16"}}')$$,
  'PT422', 'P.A.P horizontal: choose 0 to 8 inches in 1/16 steps', 'horizontal P.A.P is 0 to 8 inches');
select is(private.normalize_fit_snapshot('{"pap": null}') -> 'pap_horizontal', 'null'::jsonb,
  'older snapshots with an empty P.A.P still save');
select throws_ok($$select * from public.search_customers('', 25, 0, 'shoe size')$$,
  'PT422', 'Unknown sort: shoe size', 'only known sorts are accepted');

select * from finish();
rollback;
