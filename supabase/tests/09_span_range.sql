-- Spans: 2 to 6 inches in steps of 1/16.
begin;
select plan(4);

select is(private.normalize_fit_snapshot('{"span_type": "cut_to_cut", "middle_cut_to_cut": {"entered": "4 15/16"}}') -> 'middle_cut_to_cut' ->> 'd',
  '16', 'a span on a 1/16 step is allowed');
select throws_ok($$select private.normalize_fit_snapshot('{"span_type": "cut_to_cut", "ring_cut_to_cut": {"entered": "6 1/16"}}')$$,
  'PT422', 'Ring finger span: span must be between 2 and 6 inches', 'over 6 inches is rejected');
select throws_ok($$select private.normalize_fit_snapshot('{"span_type": "cut_to_cut", "middle_cut_to_cut": {"entered": "1 7/8"}}')$$,
  'PT422', 'Middle finger span: span must be between 2 and 6 inches', 'under 2 inches is rejected');
select throws_ok($$select private.normalize_fit_snapshot('{"span_type": "cut_to_cut", "middle_cut_to_cut": {"entered": "4 1/32"}}')$$,
  'PT422', 'Middle finger span: use steps of 1/16 inch', 'finer than 1/16 is rejected');

select * from finish();
rollback;
