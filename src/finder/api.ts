import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/errors';
import type { FinderSheet } from './match';

export type DateKind = 'any' | 'paper' | 'entered';

export const DATE_KIND_LABELS: Record<DateKind, string> = {
  any: 'Any date',
  paper: 'Date on the paper sheet',
  entered: 'Date entered in the app',
};

/** Rows per request; the API returns at most 1000 at a time. */
const BATCH = 1000;

/**
 * Every saved version of every bowler's specs in the date range (inclusive days,
 * YYYY-MM-DD). The entered date is the day in this device's time zone.
 */
export async function listFinderSheets(kind: DateKind, from: string, to: string, signal?: AbortSignal): Promise<FinderSheet[]> {
  const args: Record<string, string> = {};
  if (kind === 'paper') {
    if (from) args.p_paper_from = from;
    if (to) args.p_paper_to = to;
  } else if (kind === 'entered') {
    if (from) args.p_entered_from = new Date(`${from}T00:00:00`).toISOString();
    if (to) {
      const next = new Date(`${to}T00:00:00`);
      next.setDate(next.getDate() + 1);
      args.p_entered_to = next.toISOString();
    }
  }
  const out: FinderSheet[] = [];
  for (let offset = 0; ; offset += BATCH) {
    let req = supabase.rpc('ball_finder_sheets', args).range(offset, offset + BATCH - 1);
    if (signal) req = req.abortSignal(signal);
    const rows = unwrap(await req) as FinderSheet[];
    out.push(...rows);
    if (rows.length < BATCH) return out;
  }
}

/** First and last day of a month picked as YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const last = new Date(Number(m[1]), Number(m[2]), 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
