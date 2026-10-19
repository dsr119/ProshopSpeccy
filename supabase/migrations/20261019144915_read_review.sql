-- The admin's review of an AI reading of a whole sheet (read_sheet): which
-- values were right, the right value for the ones that weren't, and a note.
-- Used to measure and tune the reader before it runs on the whole queue.

alter table public.intake_items
  add column read_review jsonb,
  add column read_reviewed_by text,
  add column read_reviewed_at timestamptz;

create function public.save_read_review(p_id uuid, p_review jsonb, p_by text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_review is null or jsonb_typeof(p_review) <> 'object' or length(p_review::text) > 20000 then
    raise exception 'The review is too long' using errcode = 'PT422';
  end if;
  update public.intake_items
     set read_review = p_review,
         read_reviewed_by = nullif(left(trim(coalesce(p_by, '')), 120), ''),
         read_reviewed_at = now()
   where id = p_id and removed_at is null and read_sheet is not null and private.is_shop_member(shop_id);
  if not found then
    raise exception 'Sheet not found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function public.save_read_review(uuid, jsonb, text) from public;
grant execute on function public.save_read_review(uuid, jsonb, text) to anon, authenticated;
