-- Grips, picked sizes and thumb slugs.
begin;
select plan(10);

select is(private.normalize_fit_snapshot('{"middle_hole": {"entered": "55/64"}}') -> 'middle_hole' ->> 'entered',
  '55/64', 'a drilled hole on a 1/64 step is allowed');
select throws_ok($$select private.normalize_fit_snapshot('{"thumb_hole": {"entered": "1 5/16"}}')$$,
  'PT422', 'Thumb hole size: choose a size from the list', 'holes over 1 1/4 are rejected');
select is(private.normalize_fit_snapshot('{"finger_grips": "grips", "grip_type": "vaccu", "middle_hole": {"entered": "31/32"}, "middle_grip_size": {"entered": "37/64"}}') ->> 'grip_type',
  'vaccu', 'grips with a grip type, grip hole and grip size are kept');
select throws_ok($$select private.normalize_fit_snapshot('{"finger_grips": "grips", "ring_hole": {"entered": "55/64"}}')$$,
  'PT422', 'Ring finger hole size: choose a size from the list', 'grip holes are 7/8, 31/32 or 1 1/32');
select throws_ok($$select private.normalize_fit_snapshot('{"finger_grips": "no_grips", "middle_grip_size": {"entered": "9/16"}}')$$,
  'PT422', 'Grip type and grip sizes are only used with grips', 'grip sizes need grips');
select is(private.normalize_fit_snapshot('{"finger_grips": "grips", "ring_grip_size": {"entered": "29/32"}}') -> 'ring_grip_size' ->> 'entered',
  '29/32', 'grip size 11 (29/32) is allowed');
select throws_ok($$select private.normalize_fit_snapshot('{"bridge": {"entered": "9/16"}}')$$,
  'PT422', 'Bridge: choose a size from the list', 'bridge is 1/8 to 1/2');
select throws_ok($$select private.normalize_fit_snapshot('{"thumb_od": {"entered": "1"}}')$$,
  'PT422', 'Thumb slug size: choose a size from the list', 'slug sizes are 7/8, 1 1/8, 1 1/4 or 1 3/8');
select throws_ok($$select private.normalize_fit_snapshot('{"thumb_insert_type": "Turbo", "thumb_hole": {"entered": "1"}}')$$,
  'PT422', 'Thumb hole size and slug size are not used with an interchangeable thumb insert', 'interchangeable inserts take no hole size');
select is(private.normalize_fit_snapshot('{"thumb_insert_type": "Thumb Slug", "thumb_hole": {"entered": "1"}, "thumb_od": {"entered": "1 1/8"}}') ->> 'thumb_insert_type',
  'Thumb Slug', 'a thumb slug takes a hole size and slug size');

select * from finish();
rollback;
