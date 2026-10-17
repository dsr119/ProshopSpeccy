-- Span type: which span the upper boxes record.
begin;
select plan(4);

select is(private.normalize_fit_snapshot('{"span_type": "full_span", "middle_cut_to_cut": {"entered": "4 3/4"}}') ->> 'span_type',
  'full_span', 'a chosen span type is kept');
select is(private.normalize_fit_snapshot('{"ring_cut_to_cut": {"entered": "4 5/16"}}') ->> 'span_type',
  'cut_to_cut', 'spans saved without a type are cut-to-cut');
select is(private.normalize_fit_snapshot('{"middle_hole": {"entered": "1"}}') -> 'span_type',
  'null'::jsonb, 'no span, no span type');
select throws_ok($$select private.normalize_fit_snapshot('{"span_type": "palm"}')$$,
  'PT422', null, 'unknown span types are rejected');

select * from finish();
rollback;
