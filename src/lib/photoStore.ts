// Where new photo files go. 'r2' keeps them in Cloudflare R2 through the
// photo-files function (supabase/functions/photo-files); 'supabase' keeps them
// in Supabase Storage. Records always stay in the database, and each record's
// `store` says where its own file is, so older photos keep working.

import { AppError, toAppError } from './errors';
import { supabase, supabasePublicKey, supabaseUrl } from './supabase';

export type PhotoStore = 'supabase' | 'r2';

export const NEW_PHOTO_STORE: PhotoStore = import.meta.env.VITE_PHOTO_STORE === 'r2' ? 'r2' : 'supabase';

const endpoint = () => (import.meta.env.VITE_PHOTO_FILES_URL as string | undefined) || `${supabaseUrl}/functions/v1/photo-files`;

async function call<T>(op: 'get' | 'put' | 'delete', keys: string[]): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? supabasePublicKey ?? '';
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabasePublicKey ?? '', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, keys }),
    });
  } catch (e) {
    throw toAppError(e);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 403) throw new AppError('forbidden', body.error ?? "You can't use that photo.");
  if (!res.ok) throw new AppError('unknown', body.error ?? `Photo storage didn't answer (${res.status}). Try again.`);
  return body as T;
}

/** Short-lived links to view R2 photo files, by key. */
export async function r2ViewUrls(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += 50) {
    Object.assign(out, (await call<{ urls: Record<string, string> }>('get', keys.slice(i, i + 50))).urls);
  }
  return out;
}

/** Uploads a new file to R2 under `key`. */
export async function r2Upload(key: string, file: Blob): Promise<void> {
  const { urls } = await call<{ urls: Record<string, string> }>('put', [key]);
  let res: Response;
  try {
    res = await fetch(urls[key], { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  } catch (e) {
    throw toAppError(e);
  }
  if (!res.ok) throw new AppError('unknown', `The photo didn't upload (${res.status}). Try again.`);
}

/** Removes R2 files that no record uses (after a failed save). Never throws. */
export async function r2Remove(keys: string[]): Promise<void> {
  await call('delete', keys).catch(() => undefined);
}
