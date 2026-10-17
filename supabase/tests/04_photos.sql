-- Photo records must point at a real file in the customer's folder, and the
-- bucket stays private with type and size limits.
begin;
select plan(8);

select is((select public from storage.buckets where id = 'spec-photos'), false, 'bucket is private');
select is((select file_size_limit from storage.buckets where id = 'spec-photos'), 15728640::bigint, 'bucket enforces 15 MB');
select is((select allowed_mime_types from storage.buckets where id = 'spec-photos'),
  array['image/jpeg', 'image/png', 'image/webp'], 'bucket accepts only JPEG, PNG and WebP');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);

-- Photo-only customer: upload before any digital specs exist (customer 3 has no fit).
insert into storage.objects (bucket_id, name, metadata) values ('spec-photos',
  '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0003/33333333-3333-4333-8333-333333333333/original.png',
  '{"mimetype": "image/png", "size": 2048}');
insert into public.spec_photos (id, customer_id, shop_id, object_path, mime_type, size_bytes, caption, author_id)
values ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-00000000005a',
  '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0003/33333333-3333-4333-8333-333333333333/original.png',
  'image/jpeg', 1, 'old sheet', '00000000-0000-4000-8000-0000000000a1');

select is((select mime_type from public.spec_photos where id = '33333333-3333-4333-8333-333333333333'), 'image/png',
  'type is taken from the stored file');
select is((select author_id from public.spec_photos where id = '33333333-3333-4333-8333-333333333333'),
  '00000000-0000-4000-8000-0000000000a2'::uuid, 'uploader is the signed-in staff member');
select ok((select has_specs = false and photo_count = 1 from public.search_customers('lefty')),
  'photo-only customer is searchable');

select throws_ok(
  $$insert into public.spec_photos (customer_id, shop_id, object_path, mime_type, size_bytes)
    values ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-00000000005a',
    '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0003/44444444-4444-4444-8444-444444444444/original.png',
    'image/png', 10)$$,
  'PT422', 'Uploaded file not found', 'metadata without an uploaded file is rejected');
select throws_ok(
  $$insert into public.spec_photos (customer_id, shop_id, object_path, mime_type, size_bytes)
    values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000005a',
    '00000000-0000-4000-8000-00000000005a/00000000-0000-4000-8000-0000000c0003/33333333-3333-4333-8333-333333333333/original.png',
    'image/png', 10)$$,
  'PT422', 'Photo path does not match the customer', 'a file from another customer folder cannot be attached');

-- Deleting recorded files is covered through the Storage API in e2e/photos.spec.ts
-- (direct SQL deletes from storage tables are blocked by Supabase).

reset role;
select * from finish();
rollback;
