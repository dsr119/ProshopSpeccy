-- Ball finder: working out who owns a ball left in the shop. Staff measure the
-- ball, and the app scores every saved version of every bowler's specs against
-- those measurements (src/finder/match.ts). This function hands the app the
-- versions to score, with the two dates it can filter on:
--
-- sheet_date: the date written on the paper sheet, read by the AI reader
--   (spec_photos.sheet_date). A version made from a photo takes that photo's
--   date; a later edit of it keeps the date of the sheet it was corrected from.
-- entered_at: when the version was saved in the app.
--
-- Only the fields that can be measured off a ball are returned, so a page of
-- rows stays small. Keep the list in step with MATCH_FIELD_KEYS in match.ts.

create function public.ball_finder_sheets(
  p_paper_from date default null,
  p_paper_to date default null,
  p_entered_from timestamptz default null,
  p_entered_to timestamptz default null
)
returns table (
  revision_id uuid,
  customer_id uuid,
  name text,
  phone text,
  revision_number integer,
  is_current boolean,
  specs jsonb,
  sheet_date date,
  entered_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with revs as (
    select r.id, r.revision_number, r.snapshot, r.created_at, f.customer_id,
           f.current_revision_id = r.id as is_current,
           (select p.sheet_date
              from public.spec_photos p
              join public.fit_revisions src on src.id in (p.revision_id, p.imported_revision_id)
             where p.customer_id = f.customer_id
               and p.removed_at is null
               and p.sheet_date is not null
               and src.fit_id = r.fit_id
               and src.revision_number <= r.revision_number
             order by src.revision_number desc, p.created_at desc
             limit 1) as sheet_date
      from public.fit_revisions r
      join public.fits f on f.id = r.fit_id
  )
  select v.id, c.id, c.name, c.phone, v.revision_number, coalesce(v.is_current, false),
         (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            from jsonb_each(v.snapshot) e
           where e.key = any (array[
             'hand', 'thumb_mode', 'finger_grips', 'thumb_insert_type',
             'middle_hole', 'ring_hole', 'thumb_hole', 'middle_grip_size', 'ring_grip_size', 'thumb_od', 'bridge',
             'middle_cut_to_cut', 'ring_cut_to_cut', 'middle_full_span', 'ring_full_span',
             'middle_cut_to_outer', 'ring_cut_to_outer', 'span_type',
             'middle_lateral_pitch', 'middle_fr_pitch', 'ring_lateral_pitch', 'ring_fr_pitch',
             'thumb_lateral_pitch', 'thumb_fr_pitch'
           ])),
         v.sheet_date, v.created_at
    from revs v
    join public.customers c on c.id = v.customer_id
   where c.removed_at is null
     and (p_paper_from is null or v.sheet_date >= p_paper_from)
     and (p_paper_to is null or v.sheet_date <= p_paper_to)
     and (p_entered_from is null or v.created_at >= p_entered_from)
     and (p_entered_to is null or v.created_at < p_entered_to)
   order by v.id;
$$;

revoke all on function public.ball_finder_sheets(date, date, timestamptz, timestamptz) from public;
grant execute on function public.ball_finder_sheets(date, date, timestamptz, timestamptz) to anon, authenticated;
