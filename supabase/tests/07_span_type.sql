-- Span type: which span the upper boxes record.
begin;
select plan(4);

select is(private.normalize_fit_snapshot('{"span_type": "full_span", "middle_cut_to_cut": {"entered": "4 3/4"}}') ->> 'span_type',
  'full_span', 'a chosen span type is kept');
select is(private.normalize_fit_snapshot('{"span_type": "full_span", "ring_cut_to_cut": {"entered": "4 5/16"}, "ring_full_span": {"entered": "4 3/4"}}') -> 'ring_full_span' ->> 'entered',
  '4 3/4', 'each span type is saved alongside the others');
select is(private.normalize_fit_snapshot('{"middle_hole": {"entered": "1"}}') -> 'span_type',
  'null'::jsonb, 'no span, no span type');
select throws_ok($$select private.normalize_fit_snapshot('{"span_type": "palm"}')$$,
  'PT422', null, 'unknown span types are rejected');

select * from finish();
rollback;
