import { PHOTO_BUCKET, supabase } from '../lib/supabase';
import { AppError, toAppError, unwrap } from '../lib/errors';

export interface SpecPhoto {
  id: string;
  customer_id: string;
  shop_id: string;
  revision_id: string | null;
  object_path: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: number;
  rotation: 0 | 90 | 180 | 270;
  caption: string | null;
  kind: PhotoKind;
  confirmed: boolean;
  confirmed_at: string | null;
  confirmed_by: string | null;
  author_name: string | null;
  created_at: string;
}

export type PhotoKind = 'spec_sheet' | 'ball';
export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = { spec_sheet: 'Spec sheet', ball: 'Ball' };

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Returns a message when the file cannot be uploaded, otherwise null. */
export function checkPhotoFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/.test(name)) {
    return 'HEIC photos are not supported yet. On an iPhone, choose Settings > Camera > Formats > Most Compatible, or share the photo as JPEG.';
  }
  if (!ACCEPTED_TYPES[file.type]) {
    return 'That file type is not supported. Upload a JPEG, PNG or WebP photo.';
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 15 MB.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export async function listPhotos(customerId: string): Promise<SpecPhoto[]> {
  return unwrap(
    await supabase.from('spec_photos').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
  ) as SpecPhoto[];
}

export async function signedUrls(paths: string[], expiresIn = 600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, expiresIn);
  if (error) throw toAppError(error);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

export interface UploadInput {
  shopId: string;
  customerId: string;
  file: File;
  rotation: number;
  caption: string;
  kind: PhotoKind;
  revisionId: string | null;
}

export async function uploadPhoto(input: UploadInput): Promise<SpecPhoto> {
  const problem = checkPhotoFile(input.file);
  if (problem) throw new AppError('validation', problem);

  const photoId = crypto.randomUUID();
  const path = `${input.shopId}/${input.customerId}/${photoId}/original.${ACCEPTED_TYPES[input.file.type]}`;

  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, input.file, {
    contentType: input.file.type,
    upsert: false,
    cacheControl: '3600',
  });
  if (up.error) throw toAppError(up.error);

  const meta = await supabase
    .from('spec_photos')
    .insert({
      id: photoId,
      customer_id: input.customerId,
      shop_id: input.shopId,
      revision_id: input.revisionId,
      object_path: path,
      original_filename: input.file.name.slice(0, 255),
      mime_type: input.file.type,
      size_bytes: input.file.size,
      rotation: input.rotation,
      caption: input.caption.trim() || null,
      kind: input.kind,
    })
    .select('*')
    .single();

  if (meta.error) {
    // Don't leave an unrecorded file behind; the customer record is untouched.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined);
    throw toAppError(meta.error);
  }
  return meta.data as SpecPhoto;
}

export async function updatePhoto(id: string, changes: { caption?: string | null; rotation?: number; confirmed?: boolean }): Promise<SpecPhoto> {
  return unwrap(await supabase.from('spec_photos').update(changes).eq('id', id).select('*').single()) as SpecPhoto;
}
