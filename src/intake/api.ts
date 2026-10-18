import { INTAKE_BUCKET, supabase } from '../lib/supabase';
import { AppError, toAppError, unwrap } from '../lib/errors';
import { ACCEPTED_TYPES, checkPhotoFile, uploadPhoto } from '../photos/api';
import { shrinkPhoto } from '../lib/shrinkPhoto';

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
  /** The back of the sheet, when something is written there. */
  back_path: string | null;
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

/** Shrinks a photo and stores it in the queue's bucket; returns its path and the stored size. */
async function storePhoto(path: (ext: string) => string, original: File): Promise<{ path: string; file: File }> {
  const file = await shrinkPhoto(original);
  const problem = checkPhotoFile(file);
  if (problem) throw new AppError('validation', problem);
  const full = path(ACCEPTED_TYPES[file.type]);
  const up = await supabase.storage.from(INTAKE_BUCKET).upload(full, file, { contentType: file.type, upsert: false });
  if (up.error) throw toAppError(up.error);
  return { path: full, file };
}

/** Puts one photo of a paper sheet (its front) in the queue. */
export async function addToQueue(shopId: string, original: File, addedBy: string): Promise<IntakeItem> {
  const id = crypto.randomUUID();
  const { path, file } = await storePhoto((ext) => `${shopId}/${id}/original.${ext}`, original);
  const row = await supabase
    .from('intake_items')
    .insert({ id, shop_id: shopId, object_path: path, mime_type: file.type, size_bytes: file.size, added_by: addedBy })
    .select('*')
    .single();
  if (row.error) {
    await supabase.storage.from(INTAKE_BUCKET).remove([path]).catch(() => undefined);
    throw toAppError(row.error);
  }
  return row.data as IntakeItem;
}

export async function intakePhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(INTAKE_BUCKET).createSignedUrl(path, 3600);
  if (error) throw toAppError(error);
  return data.signedUrl;
}

/** Adds the back of a sheet that is already in the queue. */
export async function addBack(item: IntakeItem, original: File): Promise<IntakeItem> {
  const { path } = await storePhoto((ext) => `${item.shop_id}/${item.id}/back-${Date.now()}.${ext}`, original);
  const res = await supabase.rpc('set_intake_back', { p_id: item.id, p_path: path });
  if (res.error) {
    await supabase.storage.from(INTAKE_BUCKET).remove([path]).catch(() => undefined);
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
  const dl = await supabase.storage.from(INTAKE_BUCKET).download(path);
  if (dl.error) throw toAppError(dl.error);
  const ext = path.split('.').pop() ?? 'jpg';
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
 * Sends a typed-in sheet to the app: its front (and back) are copied into the
 * bowler's Photos as spec sheets and the queue entry is marked done. The queue's
 * own copies are then removed, so each photo is stored once.
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
  const paths = [item.object_path, item.back_path].filter((p): p is string => !!p);
  await supabase.storage.from(INTAKE_BUCKET).remove(paths).catch(() => undefined);
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
