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
  removed_at?: string | null;
  removed_by?: string | null;
  /** Name and phone read off the photo by AI, as a suggestion to check. */
  read_name?: string | null;
  read_phone?: string | null;
  read_unsure?: boolean | null;
  /** Why the last person passed it, when they did. */
  pass_reason?: PassReason | null;
  passed_by?: string | null;
  passed_at?: string | null;
}

export const PASS_REASONS = {
  too_blurry: 'Too blurry',
  dont_understand: "Don't understand",
  too_sloppy: 'Too sloppy',
  no_name: 'No name',
  incomplete_specs: 'Incomplete specs',
  no_specs: 'No specs',
} as const;
export type PassReason = keyof typeof PASS_REASONS;

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
  // Newest first for finished and passed sheets; the queue itself in the order it is worked.
  const order = status === 'done' ? 'done_at' : status === 'unreadable' ? 'passed_at' : 'created_at';
  return unwrap(
    await supabase
      .from('intake_items')
      .select('*')
      .eq('status', status)
      .order(order, { ascending: order === 'created_at', nullsFirst: false })
      .limit(limit),
  ) as IntakeItem[];
}

// A sheet just handed out by the queue, so opening it doesn't fetch it again.
const handedOut = new Map<string, IntakeItem>();

export async function getItem(id: string): Promise<IntakeItem> {
  const known = handedOut.get(id);
  if (known) {
    handedOut.delete(id);
    return known;
  }
  return unwrap(await supabase.from('intake_items').select('*').eq('id', id).single()) as IntakeItem;
}

function handOut(item: IntakeItem): IntakeItem {
  handedOut.set(item.id, item);
  preloadSheet(item);
  return item;
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

// Viewing links last an hour; reuse them for most of that so a sheet's photo
// is fetched once and comes from the browser's cache after that.
const LINK_REUSE_MS = 45 * 60 * 1000;
const links = new Map<string, { url: Promise<string>; at: number }>();

async function signSides(item: Pick<IntakeItem, 'store'>, paths: string[]): Promise<Record<string, string>> {
  if (item.store === 'r2') return r2ViewUrls(paths);
  const { data, error } = await supabase.storage.from(INTAKE_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw toAppError(error);
  return Object.fromEntries(data.map((d, i) => [paths[i], d.signedUrl ?? '']));
}

/** Links for the front and back of a sheet, signed together in one call and remembered. */
function sheetLinks(item: Pick<IntakeItem, 'store' | 'object_path' | 'back_path'>): Promise<string>[] {
  const now = Date.now();
  const paths = [item.object_path, item.back_path].filter((p): p is string => !!p);
  const missing = paths.filter((p) => !(links.get(p) && now - links.get(p)!.at < LINK_REUSE_MS));
  if (missing.length) {
    const signed = signSides(item, missing);
    for (const p of missing) {
      const url = signed.then((all) => {
        if (!all[p]) throw new AppError('unknown', "Couldn't get the photo. Try again.");
        return all[p];
      });
      url.catch(() => links.delete(p));
      links.set(p, { url, at: now });
    }
  }
  return paths.map((p) => links.get(p)!.url);
}

/** A viewing link for the front or back of a queued sheet. */
export async function intakePhotoUrl(item: Pick<IntakeItem, 'store' | 'object_path' | 'back_path'>, path: string): Promise<string> {
  const urls = sheetLinks(item);
  return path === item.back_path && urls.length > 1 ? urls[1] : urls[0];
}

/** Starts downloading a sheet's photos in the background, so they show at once when it's opened. */
export function preloadSheet(item: IntakeItem) {
  for (const url of sheetLinks(item)) {
    url
      .then((u) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = u;
      })
      .catch(() => undefined);
  }
}

/** Gets the photos of the sheet most likely to come up next ready, without taking it. */
export async function preloadUpNext(skipId: string): Promise<void> {
  const res = await supabase
    .from('intake_items')
    .select('*')
    .eq('status', 'waiting')
    .neq('id', skipId)
    .order('created_at')
    .limit(1);
  const item = res.data?.[0] as IntakeItem | undefined;
  if (item) preloadSheet(item);
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
  return item?.id ? handOut(item) : null;
}

export async function releaseItem(id: string, unreadable = false, note: string | null = null): Promise<IntakeItem> {
  const res = await supabase.rpc('release_intake', { p_id: id, p_unreadable: unreadable, p_note: note });
  if (res.error) throw toAppError(res.error);
  return res.data as IntakeItem;
}

/** Takes a sheet out of the queue (a duplicate or a bad photo). It can be brought back. */
export async function removeItem(id: string, name: string): Promise<void> {
  const res = await supabase.rpc('remove_intake', { p_id: id, p_name: name });
  if (res.error) throw toAppError(res.error);
}

export async function restoreItem(id: string): Promise<void> {
  const res = await supabase.rpc('restore_intake', { p_id: id });
  if (res.error) throw toAppError(res.error);
}

/** Sheets taken out of the queue, newest first. */
export async function listRemovedItems(): Promise<IntakeItem[]> {
  const res = await supabase.rpc('list_removed_intake');
  if (res.error) throw toAppError(res.error);
  return (res.data ?? []) as IntakeItem[];
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

/**
 * Finishes a sheet and takes the next one for the same person. Sheets in R2
 * do it all in one trip to the database; older sheets copy their files first.
 * Returns the next sheet, or null when the queue is empty.
 */
export async function finishAndNext(
  item: IntakeItem,
  customerId: string,
  revisionId: string,
  name: string,
  copied: CopiedPhotos,
): Promise<IntakeItem | null> {
  if (item.store !== 'r2') {
    await finishItem(item, customerId, revisionId, name, copied);
    return claimNext(name).catch(() => null);
  }
  const res = await supabase.rpc('finish_intake', {
    p_id: item.id,
    p_customer_id: customerId,
    p_revision_id: revisionId,
    p_name: name,
  });
  if (res.error) {
    const err = toAppError(res.error);
    // Saved already (the answer was lost on the way back): just move on.
    if (err.kind !== 'conflict') throw err;
    return claimNext(name).catch(() => null);
  }
  const next = (res.data as { next: IntakeItem | null }).next;
  return next?.id ? handOut(next) : null;
}

/** Passes a sheet with a reason (it goes to the passed pile) and takes the next one for the same person. */
export async function passAndNext(item: IntakeItem, reason: PassReason | null, note: string, name: string): Promise<IntakeItem | null> {
  handedOut.delete(item.id);
  const res = await supabase.rpc('pass_intake', { p_id: item.id, p_reason: reason, p_note: note.trim() || null, p_name: name });
  if (res.error) throw toAppError(res.error);
  const next = (res.data as { next: IntakeItem | null }).next;
  return next?.id ? handOut(next) : null;
}

/** How much one person has done in the queue. */
export interface PersonStats {
  name: string;
  typed_today: number;
  typed_week: number;
  typed_total: number;
  added_total: number;
  working_now: number;
}

/** Everyone's counts, most sheets typed in first. "Today" and "this week" are in this device's time zone. */
export async function getPeopleStats(): Promise<PersonStats[]> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const res = await supabase.rpc('intake_stats', { p_tz: tz });
  if (res.error) throw toAppError(res.error);
  return ((res.data ?? []) as PersonStats[]).map((r) => ({
    name: r.name,
    typed_today: Number(r.typed_today),
    typed_week: Number(r.typed_week),
    typed_total: Number(r.typed_total),
    added_total: Number(r.added_total),
    working_now: Number(r.working_now),
  }));
}

/** Signing in as "admin" shows everyone's counts on the queue page and lets you add names to the list. */
export const isAdminName = (name: string) => name.trim().toLowerCase() === 'admin';
export const ADMIN_NAME = 'Admin';

/** The names people pick from to sign in on the intake page, A to Z. */
export async function listIntakeNames(): Promise<string[]> {
  const rows = unwrap(await supabase.from('intake_names').select('name').order('name'));
  return (rows as Array<{ name: string }>).map((r) => r.name);
}

export async function addIntakeName(shopId: string, name: string): Promise<string> {
  const res = await supabase.rpc('add_intake_name', { p_shop_id: shopId, p_name: name });
  if (res.error) throw toAppError(res.error);
  return (res.data as { name: string }).name;
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
