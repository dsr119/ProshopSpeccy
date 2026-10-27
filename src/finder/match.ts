// Scores saved spec sheets against measurements taken off a ball left in the
// shop, so staff can see whose ball it most likely is. Each measured field
// scores 1 when it matches the sheet exactly, falling to 0 at its tolerance.
// A field the sheet left blank scores half, so a sheet missing values neither
// wins nor loses on them, and the result says how many fields were compared.
// A number typed as a range ("3 7/8 to 4 5/16") is a filter: only sheets with
// a value inside it are listed, and those score 100% on that field.

import { parseMeasurement } from '../measurements/fraction';
import { spanField, type FieldKey, type SpanType } from '../measurements/schema';

/** Fields the finder reads from a sheet. Mirrors the list in public.ball_finder_sheets(). */
export const MATCH_FIELD_KEYS = [
  'hand',
  'thumb_mode',
  'finger_grips',
  'thumb_insert_type',
  'middle_hole',
  'ring_hole',
  'thumb_hole',
  'middle_grip_size',
  'ring_grip_size',
  'thumb_od',
  'bridge',
  'middle_cut_to_cut',
  'ring_cut_to_cut',
  'middle_full_span',
  'ring_full_span',
  'middle_cut_to_outer',
  'ring_cut_to_outer',
  'span_type',
  'middle_lateral_pitch',
  'middle_fr_pitch',
  'ring_lateral_pitch',
  'ring_fr_pitch',
  'thumb_lateral_pitch',
  'thumb_fr_pitch',
] as const satisfies readonly FieldKey[];

/** A sheet's measurable fields as the database returns them. */
export type SheetSpecs = Partial<Record<FieldKey, { entered: string; n: number; d: number; dir?: string } | string | null>>;

/** What staff measured off the ball. Every value is optional text; pitches also carry a direction. */
export interface BallMeasurements {
  hand: string;
  finger_grips: string;
  thumb_insert_type: string;
  span_type: SpanType;
  middle_span: string;
  ring_span: string;
  middle_hole: string;
  ring_hole: string;
  thumb_hole: string;
  middle_grip_size: string;
  ring_grip_size: string;
  thumb_od: string;
  bridge: string;
  middle_lateral_pitch: Pitch;
  middle_fr_pitch: Pitch;
  ring_lateral_pitch: Pitch;
  ring_fr_pitch: Pitch;
  thumb_lateral_pitch: Pitch;
  thumb_fr_pitch: Pitch;
}

export interface Pitch {
  text: string;
  /** left/right or forward/reverse; empty when the direction wasn't checked. */
  dir: string;
}

export const EMPTY_BALL: BallMeasurements = {
  hand: '',
  finger_grips: '',
  thumb_insert_type: '',
  span_type: 'cut_to_cut',
  middle_span: '',
  ring_span: '',
  middle_hole: '',
  ring_hole: '',
  thumb_hole: '',
  middle_grip_size: '',
  ring_grip_size: '',
  thumb_od: '',
  bridge: '',
  middle_lateral_pitch: { text: '', dir: '' },
  middle_fr_pitch: { text: '', dir: '' },
  ring_lateral_pitch: { text: '', dir: '' },
  ring_fr_pitch: { text: '', dir: '' },
  thumb_lateral_pitch: { text: '', dir: '' },
  thumb_fr_pitch: { text: '', dir: '' },
};

type NumberKey = Exclude<keyof BallMeasurements, 'hand' | 'finger_grips' | 'thumb_insert_type' | 'span_type'>;

interface NumberRule {
  label: string;
  /** How far off (in inches) a value can be before it scores nothing. */
  tolerance: number;
  weight: number;
  pitch?: 'lateral' | 'fr';
}

/** Spans tell bowlers apart best, then hole sizes; pitches are harder to measure off a ball. */
export const NUMBER_RULES: Record<NumberKey, NumberRule> = {
  middle_span: { label: 'Middle span', tolerance: 1 / 4, weight: 2 },
  ring_span: { label: 'Ring span', tolerance: 1 / 4, weight: 2 },
  thumb_hole: { label: 'Thumb hole', tolerance: 1 / 16, weight: 1.5 },
  middle_hole: { label: 'Middle hole', tolerance: 1 / 16, weight: 1.5 },
  ring_hole: { label: 'Ring hole', tolerance: 1 / 16, weight: 1.5 },
  middle_grip_size: { label: 'Middle grip size', tolerance: 1 / 16, weight: 1 },
  ring_grip_size: { label: 'Ring grip size', tolerance: 1 / 16, weight: 1 },
  thumb_od: { label: 'Thumb slug size', tolerance: 1 / 8, weight: 1 },
  bridge: { label: 'Bridge', tolerance: 1 / 8, weight: 0.5 },
  middle_lateral_pitch: { label: 'Middle lateral pitch', tolerance: 1 / 4, weight: 1, pitch: 'lateral' },
  middle_fr_pitch: { label: 'Middle fwd/rev pitch', tolerance: 1 / 4, weight: 1, pitch: 'fr' },
  ring_lateral_pitch: { label: 'Ring lateral pitch', tolerance: 1 / 4, weight: 1, pitch: 'lateral' },
  ring_fr_pitch: { label: 'Ring fwd/rev pitch', tolerance: 1 / 4, weight: 1, pitch: 'fr' },
  thumb_lateral_pitch: { label: 'Thumb lateral pitch', tolerance: 1 / 4, weight: 1, pitch: 'lateral' },
  thumb_fr_pitch: { label: 'Thumb fwd/rev pitch', tolerance: 1 / 4, weight: 1, pitch: 'fr' },
};

const CHOICE_RULES = {
  hand: { label: 'Hand', weight: 1 },
  finger_grips: { label: 'Finger grips', weight: 1 },
  thumb_insert_type: { label: 'Thumb insert', weight: 1 },
} as const;

/** One measured field compared with a sheet. */
export interface FieldMatch {
  label: string;
  ball: string;
  /** What the sheet says; null when it was left blank. */
  sheet: string | null;
  /** 0 to 1; 0.5 when the sheet is blank. */
  score: number;
}

export interface SheetMatch {
  /** 0 to 100, rounded. */
  percent: number;
  /** Fields the sheet had a value for. */
  compared: number;
  /** Fields measured off the ball. */
  measured: number;
  /** True when the sheet is outside a range that was typed, or has no value for it. */
  excluded: boolean;
  fields: FieldMatch[];
}

function textOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'entered' in v) return String((v as { entered: string }).entered);
  return null;
}

function inches(text: string): number | null {
  const p = parseMeasurement(text);
  return p.ok ? p.value.n / p.value.d : null;
}

/** Splits "3 7/8 to 4 5/16" (also "3 7/8 - 4 5/16") into its two ends; null when it isn't a range. */
function splitRange(text: string): [string, string] | null {
  const parts = text.trim().split(/\s+(?:to|-|–|—)\s+|\s*[–—]\s*|\s+to\s*/i);
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

/** A typed value as a low and high amount (the same for a single value); null when it can't be read. */
export function parseAmount(text: string): { lo: number; hi: number; range: boolean } | { error: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const ends = splitRange(trimmed);
  if (!ends) {
    const p = parseMeasurement(trimmed);
    return p.ok ? { lo: p.value.n / p.value.d, hi: p.value.n / p.value.d, range: false } : { error: p.error };
  }
  const [a, b] = ends.map((e) => parseMeasurement(e));
  if (!a.ok) return { error: a.error };
  if (!b.ok) return { error: b.error };
  const x = a.value.n / a.value.d;
  const y = b.value.n / b.value.d;
  return { lo: Math.min(x, y), hi: Math.max(x, y), range: true };
}

function readAmount(text: string): { lo: number; hi: number; range: boolean } | null {
  const a = parseAmount(text);
  return a && !('error' in a) ? a : null;
}

/** A pitch as a signed number: right and forward are positive. */
function signedPitch(amount: number, dir: string): number {
  return dir === 'left' || dir === 'reverse' ? -amount : amount;
}

/** The sheet field a ball measurement is compared with. */
function sheetKey(key: NumberKey, spanType: SpanType): FieldKey {
  if (key === 'middle_span') return spanField('middle', spanType);
  if (key === 'ring_span') return spanField('ring', spanType);
  return key;
}

/** True when at least one field has been measured. */
export function hasMeasurements(ball: BallMeasurements): boolean {
  return measuredFields(ball).length > 0;
}

function measuredFields(ball: BallMeasurements): Array<keyof BallMeasurements> {
  const out: Array<keyof BallMeasurements> = [];
  for (const key of Object.keys(CHOICE_RULES) as Array<keyof typeof CHOICE_RULES>) if (ball[key]) out.push(key);
  for (const key of Object.keys(NUMBER_RULES) as NumberKey[]) {
    const v = ball[key];
    const text = typeof v === 'string' ? v : v.text;
    if (readAmount(text)) out.push(key);
  }
  return out;
}

/** Ball fields typed in a way that can't be read as a number, with the parser's message. */
export function measurementErrors(ball: BallMeasurements): Partial<Record<NumberKey, string>> {
  const errors: Partial<Record<NumberKey, string>> = {};
  for (const key of Object.keys(NUMBER_RULES) as NumberKey[]) {
    const v = ball[key];
    const a = parseAmount(typeof v === 'string' ? v : v.text);
    if (a && 'error' in a) errors[key] = a.error;
  }
  return errors;
}

/** Scores one sheet against the ball. */
export function scoreSheet(ball: BallMeasurements, specs: SheetSpecs): SheetMatch {
  const fields: FieldMatch[] = [];
  let total = 0;
  let weights = 0;
  let compared = 0;
  let excluded = false;

  for (const key of measuredFields(ball)) {
    if (key in CHOICE_RULES) {
      const rule = CHOICE_RULES[key as keyof typeof CHOICE_RULES];
      const ballValue = ball[key as keyof typeof CHOICE_RULES];
      const sheetValue = textOf(specs[key as FieldKey]);
      const score = sheetValue == null ? 0.5 : sheetValue === ballValue ? 1 : 0;
      if (sheetValue != null) compared++;
      fields.push({ label: rule.label, ball: ballValue, sheet: sheetValue, score });
      total += score * rule.weight;
      weights += rule.weight;
      continue;
    }

    const numKey = key as NumberKey;
    const rule = NUMBER_RULES[numKey];
    const raw = ball[numKey];
    const ballText = (typeof raw === 'string' ? raw : raw.text).trim();
    const ballDir = typeof raw === 'string' ? '' : raw.dir;
    const amount = readAmount(ballText) as { lo: number; hi: number; range: boolean };
    const sheetRaw = specs[sheetKey(numKey, ball.span_type)];
    const sheetText = textOf(sheetRaw);
    const sheetAmount = sheetText == null ? null : inches(sheetText);
    const sheetDir = sheetRaw && typeof sheetRaw === 'object' ? sheetRaw.dir ?? '' : '';
    // Without a direction on the ball, only the amount is compared.
    const signed = !!rule.pitch && !!ballDir && amount.hi !== 0;
    const lo = signed ? Math.min(signedPitch(amount.lo, ballDir), signedPitch(amount.hi, ballDir)) : amount.lo;
    const hi = signed ? Math.max(signedPitch(amount.lo, ballDir), signedPitch(amount.hi, ballDir)) : amount.hi;

    let score = 0.5;
    if (sheetAmount != null) {
      compared++;
      const value = signed ? signedPitch(sheetAmount, sheetDir) : sheetAmount;
      const diff = Math.max(lo - value, 0, value - hi);
      score = Math.max(0, 1 - diff / rule.tolerance);
      if (amount.range && diff > 1e-9) excluded = true;
    } else if (amount.range) {
      excluded = true;
    }
    fields.push({
      label: rule.label,
      ball: signed ? `${ballText} ${ballDir}` : ballText,
      sheet: sheetText == null ? null : sheetDir && sheetDir !== 'none' ? `${sheetText} ${sheetDir}` : sheetText,
      score,
    });
    total += score * rule.weight;
    weights += rule.weight;
  }

  return {
    percent: weights ? Math.round((total / weights) * 100) : 0,
    compared,
    measured: fields.length,
    fields,
    excluded,
  };
}

export interface FinderSheet {
  revision_id: string;
  customer_id: string;
  name: string;
  phone: string | null;
  revision_number: number;
  is_current: boolean;
  specs: SheetSpecs;
  sheet_date: string | null;
  entered_at: string;
}

export interface BowlerMatch extends SheetMatch {
  sheet: FinderSheet;
  /** How many of this bowler's versions were scored. */
  versions: number;
}

/**
 * The best-scoring version for each bowler, best bowlers first. Sheets that share
 * no measured field with the ball, or fall outside a typed range, are left out. Ties go to more fields compared,
 * then the current version, then the newest.
 */
export function rankBowlers(ball: BallMeasurements, sheets: FinderSheet[]): BowlerMatch[] {
  const best = new Map<string, BowlerMatch>();
  for (const sheet of sheets) {
    const m = scoreSheet(ball, sheet.specs);
    if (m.compared === 0 || m.excluded) continue;
    const prev = best.get(sheet.customer_id);
    const candidate: BowlerMatch = { ...m, sheet, versions: (prev?.versions ?? 0) + 1 };
    if (!prev || better(candidate, prev)) best.set(sheet.customer_id, candidate);
    else prev.versions++;
  }
  return [...best.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : a.sheet.name.localeCompare(b.sheet.name)));
}

function better(a: BowlerMatch, b: BowlerMatch): boolean {
  if (a.percent !== b.percent) return a.percent > b.percent;
  if (a.compared !== b.compared) return a.compared > b.compared;
  if (a.sheet.is_current !== b.sheet.is_current) return a.sheet.is_current;
  return a.sheet.entered_at > b.sheet.entered_at;
}
