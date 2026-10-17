-- Shared fixture ids come from supabase/seed.sql (fictional data).
--   admin    00000000-0000-4000-8000-0000000000a1
--   staff    00000000-0000-4000-8000-0000000000a2
--   staff2   00000000-0000-4000-8000-0000000000a3
--   outsider 00000000-0000-4000-8000-0000000000a4 (account, no membership)
--   shop     00000000-0000-4000-8000-00000000005a
begin;
select plan(1);
select ok(exists (select 1 from public.shops where id = '00000000-0000-4000-8000-00000000005a'), 'seed data is loaded');
select * from finish();
rollback;
