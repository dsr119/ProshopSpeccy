-- Atomic saves, conflicts, no-change saves, restore, validation, blank vs zero.
begin;
select plan(27);

create temp table t_result (label text primary key, value jsonb);
grant all on t_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);

-- Customer 2 has no fit yet.
insert into t_result values ('first', public.save_fit_revision(
  '00000000-0000-4000-8000-0000000c0002', 0,
  '{"hand": "left", "thumb_mode": "thumb_in",
    "middle_hole": {"entered": "0"}, "ring_hole": {"entered": ""}, "thumb_hole": null,
    "middle_cut_to_cut": {"entered": "4 3/8"},
    "middle_lateral_pitch": {"entered": "1/8", "dir": "left"},
    "ring_fr_pitch": {"entered": "0", "dir": "none"}}'::jsonb,
  'first save'));

select is((select (value ->> 'created')::boolean from t_result where label = 'first'), true, 'first save creates a revision');
select is((select (value ->> 'revision_number')::int from t_result where label = 'first'), 1, 'first revision is #1');
select is((select (value ->> 'lock_version')::int from t_result where label = 'first'), 1, 'lock version increments to 1');

select is(
  (select author_id from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  '00000000-0000-4000-8000-0000000000a2'::uuid, 'author is the signed-in staff member');
select is(
  (select author_name from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  'Sam Staff', 'author name is recorded');

-- Blank and zero stay distinct; notation and exact value preserved.
select is(
  (select snapshot -> 'middle_hole' from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  '{"entered": "0", "n": 0, "d": 1}'::jsonb, 'zero is stored as a measured zero');
select is(
  (select snapshot -> 'ring_hole' from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  'null'::jsonb, 'blank is stored as not recorded');
select is(
  (select snapshot -> 'middle_cut_to_cut' from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  '{"entered": "4 3/8", "n": 35, "d": 8}'::jsonb, 'mixed fraction kept as entered with exact value');
select is(
  (select snapshot -> 'middle_lateral_pitch' from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  '{"entered": "1/8", "n": 1, "d": 8, "dir": "left"}'::jsonb, 'pitch keeps magnitude and direction separately');
select ok(
  (select last_spec_at is not null from public.customers where id = '00000000-0000-4000-8000-0000000c0002'),
  'customer last spec time is updated');

-- Saving identical values is a no-op.
insert into t_result values ('same', public.save_fit_revision(
  '00000000-0000-4000-8000-0000000c0002', 1,
  '{"hand": "left", "thumb_mode": "thumb_in", "middle_hole": {"entered": "0"},
    "middle_cut_to_cut": {"entered": "4 3/8"}, "middle_lateral_pitch": {"entered": "1/8", "dir": "left"},
    "ring_fr_pitch": {"entered": "0", "dir": "none"}}'::jsonb));
select is((select (value ->> 'created')::boolean from t_result where label = 'same'), false, 'unchanged save creates nothing');
select is((select count(*)::int from public.fit_revisions r join public.fits f on f.id = r.fit_id
           where f.customer_id = '00000000-0000-4000-8000-0000000c0002'), 1, 'still one revision');

-- Second staff member saves from the same starting version: conflict.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}', true);
insert into t_result values ('second', public.save_fit_revision(
  '00000000-0000-4000-8000-0000000c0002', 1, '{"hand": "left", "thumb_mode": "no_thumb", "middle_hole": {"entered": "1/2"}}'::jsonb, 'riley'));
select is((select (value ->> 'revision_number')::int from t_result where label = 'second'), 2, 'Riley saves revision #2');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0002', 1, '{"middle_hole": {"entered": "3/4"}}'::jsonb)$$,
  'PT409', 'Someone else saved this fit since you started editing', 'stale save is rejected with a conflict');
select is((select snapshot -> 'middle_hole' ->> 'entered' from public.fit_revisions r join public.fits f on f.current_revision_id = r.id
           where f.customer_id = '00000000-0000-4000-8000-0000000c0002'), '1/2', 'the other save was not overwritten');
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0001', 0, '{"middle_hole": {"entered": "3/4"}}'::jsonb)$$,
  'PT409', null, 'creating a fit that already exists is a conflict');

-- Validation failures change nothing.
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0002', 2, '{"middle_hole": {"entered": "4 3/0"}}'::jsonb)$$,
  'PT422', null, 'zero denominator rejected');
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0002', 2, '{"thumb_hole": {"entered": "-1"}}'::jsonb)$$,
  'PT422', null, 'negative unsigned value rejected');
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0002', 2, '{"middle_lateral_pitch": {"entered": "1/8"}}'::jsonb)$$,
  'PT422', null, 'non-zero pitch without direction rejected');
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0002', 2, '{"middle_lateral_pitch": {"entered": "1/8", "dir": "forward"}}'::jsonb)$$,
  'PT422', null, 'wrong direction axis rejected');
select throws_ok(
  $$select public.save_fit_revision('00000000-0000-4000-8000-0000000c0002', 2, '{"screen_x": 10}'::jsonb)$$,
  'PT422', null, 'unknown keys rejected');
select is((select lock_version from public.fits where customer_id = '00000000-0000-4000-8000-0000000c0002'), 2,
  'failed saves leave the lock version unchanged');

-- No-thumb mode: thumb values saved earlier stay in history.
insert into t_result values ('nothumb', public.save_fit_revision(
  '00000000-0000-4000-8000-0000000c0002', 2,
  '{"hand": "left", "thumb_mode": "no_thumb", "middle_hole": {"entered": "1/2"}, "thumb_hole": {"entered": "1"}}'::jsonb));
select is((select snapshot -> 'thumb_hole' ->> 'entered' from public.fit_revisions
           where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'nothumb')), '1',
  'thumb value is kept when the fit is no-thumb');

-- Restore #1 creates #4 and keeps everything.
insert into t_result values ('restore', public.restore_fit_revision(
  (select (value ->> 'revision_id')::uuid from t_result where label = 'first'), 3));
select is((select (value ->> 'revision_number')::int from t_result where label = 'restore'), 4, 'restore creates a new revision');
select is((select count(*)::int from public.fit_revisions r join public.fits f on f.id = r.fit_id
           where f.customer_id = '00000000-0000-4000-8000-0000000c0002'), 4, 'restore keeps all history');
select is(
  (select r.snapshot from public.fit_revisions r join public.fits f on f.current_revision_id = r.id
    where f.customer_id = '00000000-0000-4000-8000-0000000c0002'),
  (select snapshot from public.fit_revisions where id = (select (value ->> 'revision_id')::uuid from t_result where label = 'first')),
  'current snapshot equals the restored one');
select throws_ok(
  format('select public.restore_fit_revision(%L, 3)', (select value ->> 'revision_id' from t_result where label = 'first')),
  'PT409', null, 'restore with a stale version is a conflict');

reset role;
select * from finish();
rollback;
