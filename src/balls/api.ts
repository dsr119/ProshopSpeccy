import { supabase } from '../lib/supabase';
import { toAppError, unwrap } from '../lib/errors';

/** A bowler's bowling ball, as written on the back of the paper spec sheet. */
export interface Ball {
  id: string;
  customer_id: string;
  position: number;
  name: string;
  weight_lbs: number | null;
  layout: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of the editor; `id` is missing for a ball not saved yet. */
export interface BallDraft {
  key: string;
  id?: string;
  name: string;
  weight: string;
  layout: string;
  notes: string;
}

export const BALL_WEIGHTS = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];

export async function listBalls(customerId: string): Promise<Ball[]> {
  return unwrap(
    await supabase.from('bowling_balls').select('*').eq('customer_id', customerId).is('removed_at', null).order('position'),
  ) as Ball[];
}

export const ballToDraft = (b: Ball): BallDraft => ({
  key: b.id,
  id: b.id,
  name: b.name,
  weight: b.weight_lbs == null ? '' : String(b.weight_lbs),
  layout: b.layout ?? '',
  notes: b.notes ?? '',
});

export const emptyBall = (): BallDraft => ({ key: crypto.randomUUID(), name: '', weight: '', layout: '', notes: '' });

const isBlank = (d: BallDraft) => !d.name.trim() && !d.weight && !d.layout.trim() && !d.notes.trim();

/** The rows that will be saved: blank rows are dropped. */
export const ballsToSave = (drafts: BallDraft[]) => drafts.filter((d) => !isBlank(d));

const comparable = (drafts: BallDraft[]) =>
  JSON.stringify(ballsToSave(drafts).map((d) => [d.id ?? null, d.name.trim(), d.weight, d.layout.trim(), d.notes.trim()]));

export const ballsEqual = (a: BallDraft[], b: BallDraft[]) => comparable(a) === comparable(b);

/** Problems by row key; a ball needs a name once anything else is filled in. */
export function validateBalls(drafts: BallDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const d of ballsToSave(drafts)) {
    if (!d.name.trim()) errors[d.key] = 'Give the ball a name.';
  }
  return errors;
}

/** Saves the whole list, in order; balls left out are removed. */
export async function saveBalls(customerId: string, drafts: BallDraft[]): Promise<Ball[]> {
  const res = await supabase.rpc('save_bowling_balls', {
    p_customer_id: customerId,
    p_balls: ballsToSave(drafts).map((d) => ({
      id: d.id ?? null,
      name: d.name.trim(),
      weight_lbs: d.weight || null,
      layout: d.layout.trim() || null,
      notes: d.notes.trim() || null,
    })),
  });
  if (res.error) throw toAppError(res.error);
  return (res.data ?? []) as Ball[];
}

export const formatWeight = (lbs: number | null) => (lbs == null ? '' : `${lbs} lb`);
