-- What the read-sheets function read off a paper sheet photo with AI: the
-- bowler's name and phone, and the measurements it found (read_sheet:
-- {fields: {key: {text, dir}}, unsure: [keys]}), used as a suggestion that
-- pre-fills the digital sheet while it is typed in. Only that function (with
-- the service role) writes these.

alter table public.intake_items
  add column read_name text,
  add column read_phone text,
  add column read_unsure boolean,
  add column read_sheet jsonb,
  add column read_error text,
  add column read_at timestamptz,
  add column read_by text,
  add column read_count integer not null default 0;

create or replace function private.intake_items_unread()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_name := null;
  new.read_phone := null;
  new.read_unsure := null;
  new.read_sheet := null;
  new.read_error := null;
  new.read_at := null;
  new.read_by := null;
  new.read_count := 0;
  return new;
end;
$$;

create trigger intake_items_unread before insert on public.intake_items
  for each row execute function private.intake_items_unread();

create index intake_items_unread_idx on public.intake_items (created_at, id) where read_at is null;
