// The single typed measurement schema used for editing, validation, display,
// history and printing. Field keys are stable database keys (snapshot schema
// version 1) and must match private.fit_field_kinds() in the migrations.

import { parseMeasurement, type Rational } from './fraction';

export const SCHEMA_VERSION = 1;

export type FieldKind =
  | 'enum_hand'
  | 'enum_thumb_mode'
  | 'enum_span_type'
  | 'text_short'
  | 'text_long'
  | 'length'
  | 'angle'
  | 'pitch_lateral'
  | 'pitch_fr';

export type FieldGroup = 'identity' | 'middle' | 'ring' | 'spans' | 'thumb' | 'details';

export interface FieldDef {
  key: FieldKey;
  kind: FieldKind;
  label: string;
  shortLabel: string;
  group: FieldGroup;
  unit?: 'in' | '°';
  /** Not applicable on the sheet when the fit is in no-thumb mode. */
  thumbDependent?: boolean;
}

export const FIELD_KEYS = [
  'hand',
  'thumb_mode',
  'fit_label',
  'middle_hole',
  'middle_oval',
  'middle_lateral_pitch',
  'middle_fr_pitch',
  'ring_hole',
  'ring_oval',
  'ring_lateral_pitch',
  'ring_fr_pitch',
  'span_type',
  'middle_cut_to_cut',
  'ring_cut_to_cut',
  'middle_actual_cut',
  'ring_actual_cut',
  'thumb_hole',
  'thumb_oval',
  'thumb_lateral_pitch',
  'thumb_fr_pitch',
  'thumb_oval_angle',
  'finger_insert_details',
  'thumb_system_details',
  'fitting_notes',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELDS: FieldDef[] = [
  { key: 'hand', kind: 'enum_hand', label: 'Bowling hand', shortLabel: 'Hand', group: 'identity' },
  { key: 'thumb_mode', kind: 'enum_thumb_mode', label: 'Thumb mode', shortLabel: 'Thumb mode', group: 'identity' },
  { key: 'fit_label', kind: 'text_short', label: 'Fit label (optional)', shortLabel: 'Label', group: 'identity' },

  { key: 'middle_hole', kind: 'length', label: 'Middle finger hole size', shortLabel: 'Hole', group: 'middle', unit: 'in' },
  { key: 'middle_oval', kind: 'text_short', label: 'Middle finger oval', shortLabel: 'Oval', group: 'middle' },
  { key: 'middle_lateral_pitch', kind: 'pitch_lateral', label: 'Middle finger lateral pitch', shortLabel: 'Lateral pitch', group: 'middle', unit: 'in' },
  { key: 'middle_fr_pitch', kind: 'pitch_fr', label: 'Middle finger forward/reverse pitch', shortLabel: 'Fwd/Rev pitch', group: 'middle', unit: 'in' },

  { key: 'ring_hole', kind: 'length', label: 'Ring finger hole size', shortLabel: 'Hole', group: 'ring', unit: 'in' },
  { key: 'ring_oval', kind: 'text_short', label: 'Ring finger oval', shortLabel: 'Oval', group: 'ring' },
  { key: 'ring_lateral_pitch', kind: 'pitch_lateral', label: 'Ring finger lateral pitch', shortLabel: 'Lateral pitch', group: 'ring', unit: 'in' },
  { key: 'ring_fr_pitch', kind: 'pitch_fr', label: 'Ring finger forward/reverse pitch', shortLabel: 'Fwd/Rev pitch', group: 'ring', unit: 'in' },

  // What the upper span boxes measure. The keys below keep their original names (stable
  // database keys); older fits without a span type were cut-to-cut.
  { key: 'span_type', kind: 'enum_span_type', label: 'Span measured', shortLabel: 'Span', group: 'spans', thumbDependent: true },
  { key: 'middle_cut_to_cut', kind: 'length', label: 'Middle finger span', shortLabel: 'Middle span', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'ring_cut_to_cut', kind: 'length', label: 'Ring finger span', shortLabel: 'Ring span', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'middle_actual_cut', kind: 'length', label: 'Middle span actual-cut', shortLabel: 'Middle actual-cut', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'ring_actual_cut', kind: 'length', label: 'Ring span actual-cut', shortLabel: 'Ring actual-cut', group: 'spans', unit: 'in', thumbDependent: true },

  { key: 'thumb_hole', kind: 'length', label: 'Thumb hole size', shortLabel: 'Hole', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_oval', kind: 'text_short', label: 'Thumb oval', shortLabel: 'Oval', group: 'thumb', thumbDependent: true },
  { key: 'thumb_lateral_pitch', kind: 'pitch_lateral', label: 'Thumb lateral pitch', shortLabel: 'Lateral pitch', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_fr_pitch', kind: 'pitch_fr', label: 'Thumb forward/reverse pitch', shortLabel: 'Fwd/Rev pitch', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_oval_angle', kind: 'angle', label: 'Thumb oval angle', shortLabel: 'Oval angle', group: 'thumb', unit: '°', thumbDependent: true },

  { key: 'finger_insert_details', kind: 'text_long', label: 'Finger insert details', shortLabel: 'Finger inserts', group: 'details' },
  { key: 'thumb_system_details', kind: 'text_long', label: 'Thumb system details', shortLabel: 'Thumb system', group: 'details' },
  { key: 'fitting_notes', kind: 'text_long', label: 'Fitting notes', shortLabel: 'Notes', group: 'details' },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldDef>;

export const GROUP_LABELS: Record<FieldGroup, string> = {
  identity: 'Fit',
  middle: 'Middle finger',
  ring: 'Ring finger',
  spans: 'Spans',
  thumb: 'Thumb',
  details: 'Inserts, thumb system and notes',
};

export type LateralDir = 'left' | 'right' | 'none';
export type ForwardDir = 'forward' | 'reverse' | 'none';
export type Hand = 'right' | 'left';
export type ThumbMode = 'thumb_in' | 'no_thumb';
export type SpanType = 'cut_to_cut' | 'full_span' | 'cut_to_switch';

export const SPAN_FIELDS = ['middle_cut_to_cut', 'ring_cut_to_cut'] as const;

/** A saved numeric value: the notation as entered plus its exact fraction. */
export interface StoredNumber extends Rational {
  entered: string;
}
export interface StoredPitch extends StoredNumber {
  dir: LateralDir | ForwardDir;
}

/** Snapshot as stored in fit_revisions.snapshot. null means "not recorded". */
export type Snapshot = {
  [K in FieldKey]: StoredNumber | StoredPitch | string | null;
};

/** Editable form state: every field is text, pitches also carry a direction. */
export interface DraftValue {
  text: string;
  dir: string;
}
export type Draft = Record<FieldKey, DraftValue>;

export function isNumericKind(kind: FieldKind): boolean {
  return kind === 'length' || kind === 'angle' || kind === 'pitch_lateral' || kind === 'pitch_fr';
}

export function isPitchKind(kind: FieldKind): boolean {
  return kind === 'pitch_lateral' || kind === 'pitch_fr';
}

/** Pitches run from 0 to 2 inches in steps of 1/32 (mirrored in private.normalize_fit_snapshot). */
export const PITCH_MAX = 2;
export const PITCH_STEP_DENOMINATOR = 32;

/** Pitch amounts offered in the editor, as entered text: 0, 1/32, 1/16, … 1 31/32, 2. */
export const PITCH_AMOUNTS: string[] = Array.from({ length: PITCH_MAX * PITCH_STEP_DENOMINATOR + 1 }, (_, i) => {
  const whole = Math.floor(i / PITCH_STEP_DENOMINATOR);
  let n = i % PITCH_STEP_DENOMINATOR;
  let d = PITCH_STEP_DENOMINATOR;
  while (n > 0 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  if (n === 0) return String(whole);
  return whole ? `${whole} ${n}/${d}` : `${n}/${d}`;
});

function pitchRangeError(value: Rational): string | null {
  if (value.n > PITCH_MAX * value.d) return `Pitch must be between 0 and ${PITCH_MAX} inches`;
  if (PITCH_STEP_DENOMINATOR % value.d !== 0) return `Use steps of 1/${PITCH_STEP_DENOMINATOR} inch`;
  return null;
}

export function emptySnapshot(): Snapshot {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as Snapshot;
}

export function snapshotToDraft(snapshot: Snapshot | null): Draft {
  const s = snapshot ?? emptySnapshot();
  return Object.fromEntries(
    FIELDS.map((f) => {
      const v = s[f.key];
      if (v == null) return [f.key, { text: '', dir: '' }];
      if (typeof v === 'string') return [f.key, { text: v, dir: '' }];
      return [f.key, { text: v.entered, dir: 'dir' in v ? v.dir : '' }];
    }),
  ) as Draft;
}

export type DraftErrors = Partial<Record<FieldKey, string>>;

/** Validates a draft without changing it. Returns per-field messages. */
export function validateDraft(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};
  for (const f of FIELDS) {
    const { text, dir } = draft[f.key];
    const trimmed = text.trim();
    if (f.kind === 'text_short' && trimmed.length > 120) errors[f.key] = 'Keep this under 120 characters';
    if (f.kind === 'text_long' && trimmed.length > 4000) errors[f.key] = 'Keep this under 4000 characters';
    if (!isNumericKind(f.kind)) continue;
    if (trimmed === '') {
      if (isPitchKind(f.kind) && dir && dir !== 'none') errors[f.key] = `Enter an amount for the ${dir} direction`;
      continue;
    }
    if (trimmed.length > 40) {
      errors[f.key] = 'Value is too long';
      continue;
    }
    const parsed = parseMeasurement(trimmed, f.kind === 'angle');
    if (!parsed.ok) {
      errors[f.key] = parsed.error;
      continue;
    }
    const rangeError = isPitchKind(f.kind) ? pitchRangeError(parsed.value) : null;
    if (rangeError) {
      errors[f.key] = rangeError;
      continue;
    }
    if (isPitchKind(f.kind) && parsed.value.n !== 0 && (!dir || dir === 'none')) {
      errors[f.key] = f.kind === 'pitch_lateral' ? 'Choose left or right' : 'Choose forward or reverse';
    }
  }
  if (!draft.span_type.text) {
    for (const key of SPAN_FIELDS) {
      if (draft[key].text.trim() !== '' && !errors[key]) errors[key] = 'Choose Cut to Cut, Full Span or Cut to Switch Grip Cut first';
    }
  }
  return errors;
}

/** Converts a valid draft into a canonical snapshot (same shape the database stores). */
export function draftToSnapshot(draft: Draft): Snapshot {
  const out = emptySnapshot() as Record<FieldKey, Snapshot[FieldKey]>;
  for (const f of FIELDS) {
    const { text, dir } = draft[f.key];
    const trimmed = text.trim();
    if (!isNumericKind(f.kind)) {
      out[f.key] = trimmed === '' ? null : trimmed;
      continue;
    }
    if (trimmed === '') continue;
    const entered = trimmed.replace(/\s+/g, ' ');
    const parsed = parseMeasurement(entered, f.kind === 'angle');
    if (!parsed.ok) throw new Error(`${f.label}: ${parsed.error}`);
    out[f.key] = isPitchKind(f.kind)
      ? { entered, ...parsed.value, dir: (dir || 'none') as LateralDir }
      : { entered, ...parsed.value };
  }
  return out as Snapshot;
}

/** Payload for save_fit_revision: entered text and direction only; the database re-parses. */
export function snapshotToPayload(snapshot: Snapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const v = snapshot[f.key];
    if (v == null || typeof v === 'string') out[f.key] = v;
    else out[f.key] = 'dir' in v ? { entered: v.entered, dir: v.dir } : { entered: v.entered };
  }
  return out;
}

export function draftsEqual(a: Draft, b: Draft): boolean {
  return FIELDS.every(
    (f) => a[f.key].text.trim() === b[f.key].text.trim() && (a[f.key].dir || '') === (b[f.key].dir || ''),
  );
}

const DIR_LABELS: Record<string, string> = {
  left: 'Left',
  right: 'Right',
  forward: 'Forward',
  reverse: 'Reverse',
  none: 'Neutral',
};

export function directionLabel(dir: string): string {
  return DIR_LABELS[dir] ?? dir;
}

export const HAND_LABELS: Record<Hand, string> = { right: 'Right-handed', left: 'Left-handed' };
export const THUMB_MODE_LABELS: Record<ThumbMode, string> = { thumb_in: 'Thumb-in', no_thumb: 'No-thumb' };
export const SPAN_TYPE_LABELS: Record<SpanType, string> = {
  cut_to_cut: 'Cut to Cut',
  full_span: 'Full Span',
  cut_to_switch: 'Cut to Switch Grip Cut',
};
/** What each span type measures, for the editor. */
export const SPAN_TYPE_HINTS: Record<SpanType, string> = {
  cut_to_cut: 'cut of finger hole to cut of thumb hole',
  full_span: 'grip to thumb cut',
  cut_to_switch: 'cut of finger hole to cut of the switch grip hole',
};

/** Plain-text value for display, history and print; null when not recorded. */
export function formatValue(key: FieldKey, value: Snapshot[FieldKey], opts: { unit?: boolean } = {}): string | null {
  if (value == null) return null;
  const f = FIELD_BY_KEY[key];
  if (typeof value === 'string') {
    if (f.kind === 'enum_hand') return HAND_LABELS[value as Hand] ?? value;
    if (f.kind === 'enum_thumb_mode') return THUMB_MODE_LABELS[value as ThumbMode] ?? value;
    if (f.kind === 'enum_span_type') return SPAN_TYPE_LABELS[value as SpanType] ?? value;
    return value;
  }
  const unit = opts.unit && f.unit ? (f.unit === '°' ? '°' : '"') : '';
  const base = `${value.entered}${unit}`;
  if ('dir' in value) return `${base} ${directionLabel(value.dir)}`;
  return base;
}

export interface FieldChange {
  key: FieldKey;
  before: string | null;
  after: string | null;
}

/** Fields whose saved value differs between two snapshots. */
export function diffSnapshots(before: Snapshot | null, after: Snapshot | null): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const f of FIELDS) {
    const a = before ? formatValue(f.key, before[f.key] ?? null) : null;
    const b = after ? formatValue(f.key, after[f.key] ?? null) : null;
    if (a !== b) changes.push({ key: f.key, before: a, after: b });
  }
  return changes;
}

/** True when the value should be shown as "not applicable" on the sheet. */
export function isNotApplicable(key: FieldKey, snapshot: Snapshot | null): boolean {
  return !!FIELD_BY_KEY[key].thumbDependent && snapshot?.thumb_mode === 'no_thumb';
}

/** What a draft field currently shows on the sheet; null when blank. */
export function parseDisplayDraft(draft: Draft, key: FieldKey): { text: string; dir?: string } | null {
  const f = FIELD_BY_KEY[key];
  const text = draft[key].text.trim();
  if (text === '') return null;
  if (f.kind === 'enum_hand') return { text: HAND_LABELS[text as Hand] ?? text };
  if (f.kind === 'enum_thumb_mode') return { text: THUMB_MODE_LABELS[text as ThumbMode] ?? text };
  if (f.kind === 'enum_span_type') return { text: SPAN_TYPE_LABELS[text as SpanType] ?? text };
  if (isPitchKind(f.kind)) return { text, dir: draft[key].dir || undefined };
  return { text };
}
