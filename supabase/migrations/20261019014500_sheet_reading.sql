-- The bowler's name and phone number as read off the paper sheet photo by the
-- read-sheets function, shown as a suggestion while the sheet is typed in.
-- Only that function (with the service role) writes these.

alter table public.intake_items
  add column read_name text,
  add column read_phone text,
  add column read_unsure boolean,
  add column read_error text,
  add column read_at timestamptz,
  add column read_by text;

create or replace function private.intake_items_unread()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_name := null;
  new.read_phone := null;
  new.read_unsure := null;
  new.read_error := null;
  new.read_at := null;
  new.read_by := null;
  return new;
end;
$$;

create trigger intake_items_unread before insert on public.intake_items
  for each row execute function private.intake_items_unread();

create index intake_items_unread_idx on public.intake_items (created_at, id) where read_at is null;
