import { INTAKE_BUCKET, supabase } from '../lib/supabase';
import { AppError, toAppError, unwrap } from '../lib/errors';
import { ACCEPTED_TYPES, attachSheetPhoto, checkPhotoFile, uploadPhoto } from '../photos/api';
import { shrinkPhoto } from '../lib/shrinkPhoto';
import { NEW_PHOTO_STORE, r2Remove, r2Upload, r2ViewUrls, type PhotoStore } from '../lib/photoStore';

export type IntakeStatus = 'waiting' | 'working' | 'done' | 'unreadable';

export interface IntakeItem {
  id: string;
  shop_id: string;
  object_path: string;
  mime_type: string;
  size_bytes: number;
  status: IntakeStatus;
  added_by: string | null;
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  note: string | null;
  /** Where the photo files are: Supabase Storage or Cloudflare R2. */
  store: PhotoStore;
  /** The back of the sheet, when something is written there. */
  back_path: string | null;
  back_size_bytes: number | null;
  customer_id: string | null;
  photo_id: string | null;
  done_by: string | null;
  done_at: string | null;
}

export type IntakeCounts = Record<IntakeStatus, number>;

export async function getCounts(): Promise<IntakeCounts> {
  const statuses: IntakeStatus[] = ['waiting', 'working', 'done', 'unreadable'];
  const counts = await Promise.all(
    statuses.map(async (s) => {
      const res = await supabase.from('intake_items').select('id', { count: 'exact', head: true }).eq('status', s);
      if (res.error) throw toAppError(res.error);
      return res.count ?? 0;
    }),
  );
  return Object.fromEntries(statuses.map((s, i) => [s, counts[i]])) as IntakeCounts;
}

export async function listItems(status: IntakeStatus, limit = 50): Promise<IntakeItem[]> {
  return unwrap(
    await supabase
      .from('intake_items')
      .select('*')
      .eq('status', status)
      .order(status === 'done' ? 'done_at' : 'created_at', { ascending: status !== 'done' })
      .limit(limit),
  ) as IntakeItem[];
}

export async function getItem(id: string): Promise<IntakeItem> {
  return unwrap(await supabase.from('intake_items').select('*').eq('id', id).single()) as IntakeItem;
}

/** Queue file paths: R2 keys start with the bucket name, Supabase paths don't. */
const queuePath = (store: PhotoStore, rest: string) => (store === 'r2' ? `${INTAKE_BUCKET}/${rest}` : rest);

/** Shrinks a photo and stores it with the queue's photos; returns its path and the stored file. */
async function storePhoto(store: PhotoStore, path: (ext: string) => string, original: File): Promise<{ path: string; file: File }> {
  const file = await shrinkPhoto(original);
  const problem = checkPhotoFile(file);
  if (problem) throw new AppError('validation', problem);
  const full = queuePath(store, path(ACCEPTED_TYPES[file.type]));
  if (store === 'r2') {
    await r2Upload(full, file);
  } else {
    const up = await supabase.storage.from(INTAKE_BUCKET).upload(full, file, { contentType: file.type, upsert: false });
    if (up.error) throw toAppError(up.error);
  }
  return { path: full, file };
}

async function removeQueueFiles(store: PhotoStore, paths: string[]) {
  if (store === 'r2') await r2Remove(paths);
  else await supabase.storage.from(INTAKE_BUCKET).remove(paths).catch(() => undefined);
}

/** Puts one photo of a paper sheet (its front) in the queue. */
export async function addToQueue(shopId: string, original: File, addedBy: string): Promise<IntakeItem> {
  const id = crypto.randomUUID();
  const store = NEW_PHOTO_STORE;
  const { path, file } = await storePhoto(store, (ext) => `${shopId}/${id}/original.${ext}`, original);
  const row = await supabase
    .from('intake_items')
    .insert({ id, shop_id: shopId, object_path: path, store, mime_type: file.type, size_bytes: file.size, added_by: addedBy })
    .select('*')
    .single();
  if (row.error) {
    await removeQueueFiles(store, [path]);
    throw toAppError(row.error);
  }
  return row.data as IntakeItem;
}

/** A viewing link for the front or back of a queued sheet. */
export async function intakePhotoUrl(item: Pick<IntakeItem, 'store'>, path: string): Promise<string> {
  if (item.store === 'r2') return (await r2ViewUrls([path]))[path];
  const { data, error } = await supabase.storage.from(INTAKE_BUCKET).createSignedUrl(path, 3600);
  if (error) throw toAppError(error);
  return data.signedUrl;
}

/** Adds the back of a sheet that is already in the queue. */
export async function addBack(item: IntakeItem, original: File): Promise<IntakeItem> {
  const { path, file } = await storePhoto(item.store, (ext) => `${item.shop_id}/${item.id}/back-${Date.now()}.${ext}`, original);
  const res = await supabase.rpc('set_intake_back', { p_id: item.id, p_path: path, p_size: file.size });
  if (res.error) {
    await removeQueueFiles(item.store, [path]);
    throw toAppError(res.error);
  }
  return res.data as IntakeItem;
}

/** The oldest sheet nobody is working on, now marked as yours; null when the queue is empty. */
export async function claimNext(name: string): Promise<IntakeItem | null> {
  const res = await supabase.rpc('claim_next_intake', { p_name: name });
  if (res.error) throw toAppError(res.error);
  const item = res.data as IntakeItem | null;
  return item?.id ? item : null;
}

export async function releaseItem(id: string, unreadable = false, note: string | null = null): Promise<IntakeItem> {
  const res = await supabase.rpc('release_intake', { p_id: id, p_unreadable: unreadable, p_note: note });
  if (res.error) throw toAppError(res.error);
  return res.data as IntakeItem;
}

/** Photos already copied to the bowler, so a retry doesn't add them twice. */
export interface CopiedPhotos {
  front?: string;
  back?: string;
}

async function copyToBowler(item: IntakeItem, path: string, customerId: string, revisionId: string, side: 'front' | 'back') {
  const ext = path.split('.').pop() ?? 'jpg';
  if (item.store === 'r2') {
    // The file is already where it needs to be; the bowler's record just points at it.
    const photo = await attachSheetPhoto({
      shopId: item.shop_id,
      customerId,
      key: path,
      mimeType: item.mime_type,
      sizeBytes: (side === 'back' ? item.back_size_bytes : item.size_bytes) || item.size_bytes,
      filename: `paper-spec-sheet-${side}.${ext}`,
      caption: `Paper spec sheet, ${side} (from the intake queue)`,
      revisionId,
    });
    return photo.id;
  }
  const dl = await supabase.storage.from(INTAKE_BUCKET).download(path);
  if (dl.error) throw toAppError(dl.error);
  const photo = await uploadPhoto({
    shopId: item.shop_id,
    customerId,
    file: new File([dl.data], `paper-spec-sheet-${side}.${ext}`, { type: dl.data.type || item.mime_type }),
    rotation: 0,
    caption: `Paper spec sheet, ${side} (from the intake queue)`,
    kind: 'spec_sheet',
    revisionId,
  });
  return photo.id;
}

/**
 * Sends a typed-in sheet to the app: its front (and back) become spec sheets in
 * the bowler's Photos and the queue entry is marked done. Each photo is stored
 * once: R2 files are shared with the bowler's records, and Supabase files are
 * copied to the bowler and the queue's copies removed.
 */
export async function finishItem(
  item: IntakeItem,
  customerId: string,
  revisionId: string,
  name: string,
  copied: CopiedPhotos,
): Promise<IntakeItem> {
  copied.front ??= await copyToBowler(item, item.object_path, customerId, revisionId, 'front');
  if (item.back_path) copied.back ??= await copyToBowler(item, item.back_path, customerId, revisionId, 'back');
  const res = await supabase.rpc('complete_intake', { p_id: item.id, p_customer_id: customerId, p_photo_id: copied.front, p_name: name });
  if (res.error) throw toAppError(res.error);
  if (item.store !== 'r2') {
    const paths = [item.object_path, item.back_path].filter((p): p is string => !!p);
    await supabase.storage.from(INTAKE_BUCKET).remove(paths).catch(() => undefined);
  }
  return res.data as IntakeItem;
}

const NAME_KEY = 'proshop:intake:name';

export function readWorkerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveWorkerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // Private browsing: the name is asked again next time.
  }
}
