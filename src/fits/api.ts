import { supabase } from '../lib/supabase';
import { AppError, toAppError, unwrap } from '../lib/errors';
import { snapshotToPayload, type Snapshot } from '../measurements/schema';

export interface Fit {
  id: string;
  customer_id: string;
  shop_id: string;
  label: string | null;
  current_revision_id: string | null;
  lock_version: number;
  created_at: string;
}

export interface FitRevision {
  id: string;
  fit_id: string;
  revision_number: number;
  schema_version: number;
  snapshot: Snapshot;
  change_note: string | null;
  restored_from_revision_id: string | null;
  author_id: string;
  author_name: string | null;
  created_at: string;
}

export interface CurrentFit {
  fit: Fit | null;
  revision: FitRevision | null;
}

export interface SaveResult {
  created: boolean;
  fit_id: string;
  revision_id: string;
  revision_number?: number;
  lock_version: number;
}

export interface ConflictInfo {
  lock_version: number;
  revision_id: string | null;
  revision_number: number | null;
  author_name: string | null;
  created_at: string | null;
}

export async function getCurrentFit(customerId: string): Promise<CurrentFit> {
  const fit = unwrap(
    await supabase.from('fits').select('*').eq('customer_id', customerId).eq('is_primary', true).maybeSingle(),
  ) as Fit | null;
  if (!fit?.current_revision_id) return { fit, revision: null };
  const revision = unwrap(
    await supabase.from('fit_revisions').select('*').eq('id', fit.current_revision_id).single(),
  ) as FitRevision;
  return { fit, revision };
}

export async function listRevisions(fitId: string): Promise<FitRevision[]> {
  return unwrap(
    await supabase.from('fit_revisions').select('*').eq('fit_id', fitId).order('revision_number', { ascending: false }),
  ) as FitRevision[];
}

export async function getRevision(id: string): Promise<FitRevision> {
  return unwrap(await supabase.from('fit_revisions').select('*').eq('id', id).single()) as FitRevision;
}

export function parseConflict(err: AppError): ConflictInfo | null {
  if (err.kind !== 'conflict') return null;
  try {
    return err.detail ? (JSON.parse(err.detail) as ConflictInfo) : null;
  } catch {
    return null;
  }
}

export async function saveFit(
  customerId: string,
  expectedLockVersion: number,
  snapshot: Snapshot,
  changeNote: string,
): Promise<SaveResult> {
  const res = await supabase.rpc('save_fit_revision', {
    p_customer_id: customerId,
    p_expected_lock_version: expectedLockVersion,
    p_snapshot: snapshotToPayload(snapshot),
    p_change_note: changeNote.trim() || null,
  });
  if (res.error) throw toAppError(res.error);
  return res.data as SaveResult;
}

export async function restoreRevision(revisionId: string, expectedLockVersion: number, note: string): Promise<SaveResult> {
  const res = await supabase.rpc('restore_fit_revision', {
    p_revision_id: revisionId,
    p_expected_lock_version: expectedLockVersion,
    p_change_note: note.trim() || null,
  });
  if (res.error) throw toAppError(res.error);
  return res.data as SaveResult;
}
