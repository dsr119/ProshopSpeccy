-- Ball motion, one or two handed, who wrote the specs, bowler details and photo kinds.
begin;
select plan(9);

select is(private.normalize_fit_snapshot('{"play_style": "two_handed", "rev_rate": {"entered": "450"}, "written_by": "Pat"}') ->> 'play_style',
  'two_handed', 'one or two handed is kept');
select is(private.normalize_fit_snapshot('{"speed": {"entered": "17.5"}}') -> 'speed' ->> 'entered',
  '17.5', 'speed keeps its decimal');
select throws_ok($$select private.normalize_fit_snapshot('{"axis_rotation": {"entered": "95"}}')$$,
  'PT422', 'Axis rotation: enter 0 to 90', 'axis rotation is 0 to 90 degrees');
select throws_ok($$select private.normalize_fit_snapshot('{"rev_rate": {"entered": "1200"}}')$$,
  'PT422', 'Rev rate: enter 0 to 1000', 'rev rate is 0 to 1000 rpm');
select throws_ok($$select private.normalize_fit_snapshot('{"play_style": "both"}')$$,
  'PT422', 'One or two handed: must be one or two handed', 'unknown styles are rejected');

select has_column('public', 'customers', 'email', 'customers have an email');
select has_column('public', 'customers', 'phone_mobile', 'customers mark a mobile phone');
select col_default_is('public', 'spec_photos', 'kind', 'spec_sheet', 'older photos are spec sheets');
select ok(exists (select 1 from pg_constraint where conname = 'spec_photos_confirm_sheets_only'),
  'only spec sheet photos can be confirmed');

select * from finish();
rollback;
