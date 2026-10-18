-- Per-person counts for the intake admin view.
begin;
select plan(4);

update public.shops set open_access = true where id = '00000000-0000-4000-8000-00000000005a';
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into public.intake_items (id, shop_id, object_path, mime_type, size_bytes, store, added_by) values
  ('00000000-0000-4000-8000-0000000004e1', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000004e1/original.jpg', 'image/jpeg', 1000, 'r2', 'Fictional Stat Taker'),
  ('00000000-0000-4000-8000-0000000004e2', '00000000-0000-4000-8000-00000000005a',
   'intake-photos/00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000004e2/original.jpg', 'image/jpeg', 1000, 'r2', ' fictional stat taker ');
-- Both are typed in by the same person under two spellings.
reset role;
update public.intake_items set status = 'done', done_by = 'Fictional Stat Typer', done_at = now() where id = '00000000-0000-4000-8000-0000000004e1';
update public.intake_items set status = 'done', done_by = 'FICTIONAL STAT TYPER', done_at = now() - interval '30 days' where id = '00000000-0000-4000-8000-0000000004e2';
set local role anon;

select is((select added_total from public.intake_stats('America/Chicago') where lower(name) = 'fictional stat taker'), 2::bigint,
  'photos taken are counted per person, ignoring capitals and spaces');
select is((select typed_total from public.intake_stats('America/Chicago') where lower(name) = 'fictional stat typer'), 2::bigint,
  'sheets typed in are counted per person');
select is((select typed_today from public.intake_stats('America/Chicago') where lower(name) = 'fictional stat typer'), 1::bigint,
  'only today''s sheets count as today');
select is((select count(*) from public.intake_stats('Not/AZone') where lower(name) = 'fictional stat typer'), 1::bigint,
  'an unknown time zone falls back to UTC');

select * from finish();
rollback;
