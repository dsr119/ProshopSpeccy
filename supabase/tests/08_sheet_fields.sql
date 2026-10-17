-- Fields added by the sheet redesign.
begin;
select plan(6);

select is(private.normalize_fit_snapshot('{"bridge": {"entered": "1/4"}}') -> 'bridge' ->> 'entered',
  '1/4', 'the bridge is a length');
select is(private.normalize_fit_snapshot('{"thumb_insert_type": "Turbo NX"}') ->> 'thumb_insert_type',
  'Turbo NX', 'a listed thumb insert type is kept');
select throws_ok($$select private.normalize_fit_snapshot('{"thumb_insert_type": "Vise"}')$$,
  'PT422', null, 'unlisted thumb insert types are rejected');
select is(private.normalize_fit_snapshot('{"span_type": "cut_to_outer", "middle_cut_to_cut": {"entered": "4"}}') ->> 'span_type',
  'cut_to_outer', 'cut to outer is a span type');
select throws_ok($$select private.normalize_fit_snapshot('{"span_type": "cut_to_switch"}')$$,
  'PT422', null, 'the old switch grip span type is gone');
select is(private.normalize_fit_snapshot('{"middle_hole": {"entered": "1"}}') -> 'thumb_od',
  'null'::jsonb, 'older fits have no value for new fields');

select * from finish();
rollback;
