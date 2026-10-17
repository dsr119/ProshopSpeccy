-- Same cases as src/measurements/fraction.test.ts so the app and database agree.
begin;
select plan(36);

select is(private.parse_measurement(t, s, 'x'), jsonb_build_object('n', n, 'd', d), format('parses %L', t))
from (values
  ('4 3/8', false, 35, 8), ('4-3/8', false, 35, 8), ('4 - 3/8', false, 35, 8), ('3/8', false, 3, 8),
  ('3 / 8', false, 3, 8), ('4.375', false, 35, 8), ('.375', false, 3, 8), ('4', false, 4, 1),
  ('0', false, 0, 1), ('0/8', false, 0, 1), ('0.0', false, 0, 1), ('6/8', false, 3, 4),
  ('9/8', false, 9, 8), ('  4   3/8  ', false, 35, 8), ('4 3/8"', false, 35, 8), ('4 3/8 in', false, 35, 8),
  ('15°', true, 15, 1), ('-10', true, -10, 1), ('-0', true, 0, 1), ('55/64', false, 55, 64),
  ('1 1/16', false, 17, 16), ('0.1', false, 1, 10)
) as v(t, s, n, d);

select throws_like(format('select private.parse_measurement(%L, %L, %L)', t, s, 'x'), '%' || m || '%', format('rejects %L', t))
from (values
  ('', false, 'blank'), ('3/0', false, 'cannot be zero'), ('4 3/0', false, 'cannot be zero'),
  ('4 9/8', false, 'less than 1'), ('-1/8', false, 'negative'), ('abc', false, 'not a number'),
  ('4 3/8/2', false, 'not a number'), ('4.', false, 'not a number'), ('1.2.3', false, 'not a number'),
  ('4 3', false, 'not a number'), ('1e3', false, 'not a number'), ('3/8 4', false, 'not a number'),
  ('1234567', false, 'not a number')
) as v(t, s, m);

select throws_ok($$select private.parse_measurement('abc', false, 'x')$$, 'PT422', null, 'parse errors use SQLSTATE PT422 (HTTP 422)');

select * from finish();
rollback;
