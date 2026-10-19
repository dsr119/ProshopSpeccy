-- The date written on each paper spec sheet. The read-dates function reads it
-- off the queue photo (sheet_date_read keeps the raw answer), and
-- private.copy_sheet_dates() copies it onto the sheet's photos in the app, so a
-- bowler's page and history can show when the paper sheet was written.

alter table public.intake_items
  add column sheet_date date,
  add column sheet_date_read jsonb;

alter table public.spec_photos
  add column sheet_date date;

-- Copies each queue sheet's date onto the photos made from it (front and back).
create function private.copy_sheet_dates()
returns integer
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.spec_photos p
       set sheet_date = i.sheet_date
      from public.intake_items i
     where i.sheet_date is not null
       and p.object_path in (i.object_path, i.back_path)
       and p.sheet_date is distinct from i.sheet_date
    returning 1
  )
  select count(*)::integer from u;
$$;

revoke all on function private.copy_sheet_dates() from public;

-- Photos added from the queue later (finish_intake, the AI reader) get the date too.
create function private.spec_photos_sheet_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sheet_date is null and new.object_path like 'intake-photos/%' then
    select i.sheet_date into new.sheet_date
      from public.intake_items i
     where new.object_path in (i.object_path, i.back_path) and i.sheet_date is not null
     limit 1;
  end if;
  return new;
end;
$$;

create trigger spec_photos_sheet_date
before insert on public.spec_photos
for each row execute function private.spec_photos_sheet_date();
