-- Pitch amounts: 0 to 2 inches in steps of 1/32.
begin;
select plan(5);

select is(private.normalize_fit_snapshot('{"middle_fr_pitch": {"entered": "2", "dir": "forward"}}') -> 'middle_fr_pitch' ->> 'n',
  '2', '2 inches is allowed');
select is(private.normalize_fit_snapshot('{"ring_lateral_pitch": {"entered": "1 31/32", "dir": "left"}}') -> 'ring_lateral_pitch' ->> 'd',
  '32', '1/32 steps are allowed');
select is(private.normalize_fit_snapshot('{"thumb_fr_pitch": {"entered": "0.125", "dir": "reverse"}}') -> 'thumb_fr_pitch' ->> 'd',
  '8', 'decimals on a 1/32 step are allowed');
select throws_ok($$select private.normalize_fit_snapshot('{"middle_lateral_pitch": {"entered": "2 1/32", "dir": "right"}}')$$,
  'PT422', 'Middle finger lateral pitch: pitch must be between 0 and 2 inches', 'over 2 inches is rejected');
select throws_ok($$select private.normalize_fit_snapshot('{"ring_fr_pitch": {"entered": "1/64", "dir": "forward"}}')$$,
  'PT422', 'Ring finger forward/reverse pitch: use steps of 1/32 inch', 'finer than 1/32 is rejected');

select * from finish();
rollback;
