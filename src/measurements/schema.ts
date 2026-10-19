// The single typed measurement schema used for editing, validation, display,
// history and printing. Field keys are stable database keys (snapshot schema
// version 1) and must match private.fit_field_kinds() in the migrations.

import { parseMeasurement, type Rational } from './fraction';

export const SCHEMA_VERSION = 1;

export type FieldKind =
  | 'enum_hand'
  | 'enum_thumb_mode'
  | 'enum_span_type'
  | 'enum_thumb_insert'
  | 'enum_grips'
  | 'enum_grip_type'
  | 'enum_play_style'
  | 'text_short'
  | 'text_long'
  | 'length'
  | 'angle'
  | 'pitch_lateral'
  | 'pitch_fr'
  /** An amount up or down, such as the vertical P.A.P. */
  | 'pitch_ud'
  /** A plain number with its own unit and range, such as rev rate or speed. */
  | 'stat';

export type FieldGroup = 'identity' | 'fingers' | 'middle' | 'ring' | 'spans' | 'thumb' | 'motion' | 'details' | 'notes';

export interface FieldDef {
  key: FieldKey;
  kind: FieldKind;
  label: string;
  shortLabel: string;
  group: FieldGroup;
  unit?: 'in' | '°' | 'rpm' | 'mph';
  /** Not applicable on the sheet when the fit is in no-thumb mode. */
  thumbDependent?: boolean;
}

export const FIELD_KEYS = [
  'hand',
  'play_style',
  'thumb_mode',
  'fit_label',
  'finger_grips',
  'grip_type',
  'middle_grip_size',
  'middle_hole',
  'middle_oval',
  'middle_lateral_pitch',
  'middle_fr_pitch',
  'middle_inserts',
  'ring_grip_size',
  'ring_hole',
  'ring_oval',
  'ring_lateral_pitch',
  'ring_fr_pitch',
  'ring_inserts',
  'bridge',
  'span_type',
  'middle_cut_to_cut',
  'ring_cut_to_cut',
  'middle_full_span',
  'ring_full_span',
  'middle_cut_to_outer',
  'ring_cut_to_outer',
  'middle_actual_cut',
  'ring_actual_cut',
  'thumb_hole',
  'thumb_oval',
  'thumb_lateral_pitch',
  'thumb_fr_pitch',
  'thumb_oval_angle',
  'thumb_od',
  'thumb_insert_type',
  'rev_rate',
  'axis_rotation',
  'axis_tilt',
  'speed',
  'pap_horizontal',
  'pap_vertical',
  'written_by',
  'finger_insert_details',
  'thumb_system_details',
  'fitting_notes',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELDS: FieldDef[] = [
  { key: 'hand', kind: 'enum_hand', label: 'Bowling hand', shortLabel: 'Hand', group: 'identity' },
  { key: 'play_style', kind: 'enum_play_style', label: 'One or two handed', shortLabel: 'Style', group: 'identity' },
  { key: 'thumb_mode', kind: 'enum_thumb_mode', label: 'Thumb mode', shortLabel: 'Thumb mode', group: 'identity' },
  { key: 'fit_label', kind: 'text_short', label: 'Fit label (optional)', shortLabel: 'Label', group: 'identity' },

  { key: 'finger_grips', kind: 'enum_grips', label: 'Finger grips', shortLabel: 'Grips', group: 'fingers' },
  { key: 'grip_type', kind: 'enum_grip_type', label: 'Grip type', shortLabel: 'Grip type', group: 'fingers' },

  { key: 'middle_grip_size', kind: 'length', label: 'Middle finger grip size', shortLabel: 'Grip size', group: 'middle', unit: 'in' },
  { key: 'middle_hole', kind: 'length', label: 'Middle finger hole size', shortLabel: 'Hole', group: 'middle', unit: 'in' },
  { key: 'middle_oval', kind: 'text_short', label: 'Middle finger oval', shortLabel: 'Oval', group: 'middle' },
  { key: 'middle_lateral_pitch', kind: 'pitch_lateral', label: 'Middle finger lateral pitch', shortLabel: 'Lateral pitch', group: 'middle', unit: 'in' },
  { key: 'middle_fr_pitch', kind: 'pitch_fr', label: 'Middle finger forward/reverse pitch', shortLabel: 'Fwd/Rev pitch', group: 'middle', unit: 'in' },
  { key: 'middle_inserts', kind: 'text_short', label: 'Middle finger inserts', shortLabel: 'Inserts', group: 'middle' },

  { key: 'ring_grip_size', kind: 'length', label: 'Ring finger grip size', shortLabel: 'Grip size', group: 'ring', unit: 'in' },
  { key: 'ring_hole', kind: 'length', label: 'Ring finger hole size', shortLabel: 'Hole', group: 'ring', unit: 'in' },
  { key: 'ring_oval', kind: 'text_short', label: 'Ring finger oval', shortLabel: 'Oval', group: 'ring' },
  { key: 'ring_lateral_pitch', kind: 'pitch_lateral', label: 'Ring finger lateral pitch', shortLabel: 'Lateral pitch', group: 'ring', unit: 'in' },
  { key: 'ring_fr_pitch', kind: 'pitch_fr', label: 'Ring finger forward/reverse pitch', shortLabel: 'Fwd/Rev pitch', group: 'ring', unit: 'in' },
  { key: 'ring_inserts', kind: 'text_short', label: 'Ring finger inserts', shortLabel: 'Inserts', group: 'ring' },

  { key: 'bridge', kind: 'length', label: 'Bridge', shortLabel: 'Bridge', group: 'spans', unit: 'in' },
  // Each span type is saved separately; span_type is the one the sheet shows.
  { key: 'span_type', kind: 'enum_span_type', label: 'Span shown', shortLabel: 'Span', group: 'spans', thumbDependent: true },
  { key: 'middle_cut_to_cut', kind: 'length', label: 'Middle finger cut to cut', shortLabel: 'Middle cut to cut', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'ring_cut_to_cut', kind: 'length', label: 'Ring finger cut to cut', shortLabel: 'Ring cut to cut', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'middle_full_span', kind: 'length', label: 'Middle finger full span', shortLabel: 'Middle full span', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'ring_full_span', kind: 'length', label: 'Ring finger full span', shortLabel: 'Ring full span', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'middle_cut_to_outer', kind: 'length', label: 'Middle finger cut to outer', shortLabel: 'Middle cut to outer', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'ring_cut_to_outer', kind: 'length', label: 'Ring finger cut to outer', shortLabel: 'Ring cut to outer', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'middle_actual_cut', kind: 'length', label: 'Middle span actual-cut', shortLabel: 'Middle actual-cut', group: 'spans', unit: 'in', thumbDependent: true },
  { key: 'ring_actual_cut', kind: 'length', label: 'Ring span actual-cut', shortLabel: 'Ring actual-cut', group: 'spans', unit: 'in', thumbDependent: true },

  { key: 'thumb_hole', kind: 'length', label: 'Thumb hole size', shortLabel: 'Hole', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_oval', kind: 'text_short', label: 'Thumb oval', shortLabel: 'Oval', group: 'thumb', thumbDependent: true },
  { key: 'thumb_lateral_pitch', kind: 'pitch_lateral', label: 'Thumb lateral pitch', shortLabel: 'Lateral pitch', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_fr_pitch', kind: 'pitch_fr', label: 'Thumb forward/reverse pitch', shortLabel: 'Fwd/Rev pitch', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_oval_angle', kind: 'angle', label: 'Thumb oval angle', shortLabel: 'Oval angle', group: 'thumb', unit: '°', thumbDependent: true },
  { key: 'thumb_od', kind: 'length', label: 'Thumb slug size', shortLabel: 'Slug size', group: 'thumb', unit: 'in', thumbDependent: true },
  { key: 'thumb_insert_type', kind: 'enum_thumb_insert', label: 'Thumb insert type', shortLabel: 'Insert type', group: 'thumb', thumbDependent: true },

  { key: 'rev_rate', kind: 'stat', label: 'Rev rate', shortLabel: 'Rev Rate', group: 'motion', unit: 'rpm' },
  { key: 'axis_rotation', kind: 'stat', label: 'Axis rotation', shortLabel: 'Axis Rotation', group: 'motion', unit: '°' },
  { key: 'axis_tilt', kind: 'stat', label: 'Axis tilt', shortLabel: 'Axis Tilt', group: 'motion', unit: '°' },
  { key: 'speed', kind: 'stat', label: 'Speed', shortLabel: 'Speed', group: 'motion', unit: 'mph' },
  { key: 'pap_horizontal', kind: 'length', label: 'P.A.P horizontal', shortLabel: 'P.A.P over', group: 'motion', unit: 'in' },
  { key: 'pap_vertical', kind: 'pitch_ud', label: 'P.A.P vertical', shortLabel: 'P.A.P up/down', group: 'motion', unit: 'in' },
  { key: 'written_by', kind: 'text_short', label: 'Specs written by', shortLabel: 'Written By', group: 'motion' },

  { key: 'finger_insert_details', kind: 'text_long', label: 'Finger insert details', shortLabel: 'Finger inserts', group: 'details' },
  { key: 'thumb_system_details', kind: 'text_long', label: 'Thumb system details', shortLabel: 'Thumb system', group: 'details' },
  { key: 'fitting_notes', kind: 'text_long', label: 'Notes', shortLabel: 'Notes', group: 'notes' },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldDef>;

export const GROUP_LABELS: Record<FieldGroup, string> = {
  identity: 'Fit',
  fingers: 'Finger grips',
  middle: 'Middle finger',
  ring: 'Ring finger',
  spans: 'Spans',
  thumb: 'Thumb',
  motion: 'Ball motion',
  details: 'Inserts and thumb system',
  notes: 'Notes',
};

export type LateralDir = 'left' | 'right' | 'none';
export type ForwardDir = 'forward' | 'reverse' | 'none';
export type VerticalDir = 'up' | 'down' | 'none';
export type Hand = 'right' | 'left';
export type ThumbMode = 'thumb_in' | 'no_thumb';
export type SpanType = 'cut_to_cut' | 'full_span' | 'cut_to_outer';
export type PlayStyle = 'one_handed' | 'two_handed';
export const PLAY_STYLE_LABELS: Record<PlayStyle, string> = { one_handed: 'One Handed', two_handed: 'Two Handed' };

/** Allowed range for each plain number at the bottom of the sheet. */
export const STAT_RANGES: Partial<Record<FieldKey, [number, number]>> = {
  rev_rate: [0, 1000],
  axis_rotation: [0, 90],
  axis_tilt: [0, 90],
  speed: [0, 40],
};

export const SPAN_FIELDS = [
  'middle_cut_to_cut',
  'ring_cut_to_cut',
  'middle_full_span',
  'ring_full_span',
  'middle_cut_to_outer',
  'ring_cut_to_outer',
] as const;

/** The saved field behind a finger's span box for a span type. */
export function spanField(finger: 'middle' | 'ring', type: SpanType | '' | null | undefined): FieldKey {
  return `${finger}_${type === 'full_span' || type === 'cut_to_outer' ? type : 'cut_to_cut'}` as FieldKey;
}

export type Grips = 'no_grips' | 'grips';
export type GripType = 'std' | 'vaccu' | 'oval_mesh' | 'oval_no_mesh' | 'lifts';
export const GRIPS_LABELS: Record<Grips, string> = { no_grips: 'No Grips', grips: 'Grips' };
export const GRIP_TYPE_LABELS: Record<GripType, string> = {
  std: 'STD',
  vaccu: 'Vaccu',
  oval_mesh: 'Oval Mesh',
  oval_no_mesh: 'Oval No Mesh',
  lifts: 'Lifts',
};

/** n/64 inch as reduced text, e.g. 72 → "1 1/8". */
function sixtyFourths(i: number): string {
  const whole = Math.floor(i / 64);
  let n = i % 64;
  let d = 64;
  while (n > 0 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  if (n === 0) return String(whole);
  return whole ? `${whole} ${n}/${d}` : `${n}/${d}`;
}

/** Drilled hole sizes, 1/4 to 1 1/4 in 1/64 steps (fingers without grips, and the thumb). */
export const HOLE_SIZES: string[] = Array.from({ length: 65 }, (_, i) => sixtyFourths(16 + i));
/** Holes drilled for finger grips. */
export const GRIP_HOLE_SIZES = ['7/8', '31/32', '1 1/32'];
/** Finger grip sizes with the grip number shown beside each. */
export const GRIP_SIZES: Array<[string, string]> = [
  ...Array.from({ length: 23 }, (_, i) => [sixtyFourths(34 + i), String((i - 2) / 2)] as [string, string]),
  ['29/32', '11'],
];
/** Bridge, 1/8 to 1/2 in 1/16 steps. */
export const BRIDGE_SIZES: string[] = Array.from({ length: 7 }, (_, i) => sixtyFourths(8 + i * 4));
/** Thumb slug sizes. */
export const SLUG_SIZES = ['7/8', '1 1/8', '1 1/4', '1 3/8'];

/** The grip number for a grip size, e.g. "9/16" → "0". */
export function gripNumber(size: string): string | null {
  const p = parseMeasurement(size);
  if (!p.ok) return null;
  const hit = GRIP_SIZES.find(([s]) => {
    const q = parseMeasurement(s);
    return q.ok && q.value.n * p.value.d === p.value.n * q.value.d;
  });
  return hit ? hit[1] : null;
}

/** Values offered by a picker on the sheet, given the rest of the draft. */
export function pickerOptions(key: FieldKey, draft: Pick<Draft, 'finger_grips'>): string[] | null {
  if (key === 'middle_hole' || key === 'ring_hole') return draft.finger_grips.text === 'grips' ? GRIP_HOLE_SIZES : HOLE_SIZES;
  if (key === 'thumb_hole') return HOLE_SIZES;
  if (key === 'middle_grip_size' || key === 'ring_grip_size') return GRIP_SIZES.map(([s]) => s);
  if (key === 'bridge') return BRIDGE_SIZES;
  if (key === 'thumb_od') return SLUG_SIZES;
  return null;
}

/** True for the interchangeable thumb inserts, which have no hole size or slug size of their own. */
export function isInterchangeable(insertType: string | null | undefined): boolean {
  return !!insertType && insertType !== 'Thumb Slug' && (THUMB_INSERT_TYPES as readonly string[]).includes(insertType);
}

/** A saved numeric value: the notation as entered plus its exact fraction. */
export interface StoredNumber extends Rational {
  entered: string;
}
export interface StoredPitch extends StoredNumber {
  dir: LateralDir | ForwardDir | VerticalDir;
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
  return kind === 'length' || kind === 'angle' || kind === 'pitch_lateral' || kind === 'pitch_fr' || kind === 'pitch_ud' || kind === 'stat';
}

export function isPitchKind(kind: FieldKind): boolean {
  return kind === 'pitch_lateral' || kind === 'pitch_fr' || kind === 'pitch_ud';
}

/** Pitches run from 0 to 2 inches and spans from 2 to 6, both in steps of 1/16 (mirrored in private.normalize_fit_snapshot). */
export const PITCH_MAX = 2;
export const PITCH_STEP_DENOMINATOR = 16;
export const SPAN_MIN = 2;
export const SPAN_MAX = 6;

/** Text for i sixteenths of an inch, reduced: 0, 1/16, 1/8, … 1 15/16, 2. */
function sixteenths(i: number): string {
  const whole = Math.floor(i / 16);
  let n = i % 16;
  let d = 16;
  while (n > 0 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  if (n === 0) return String(whole);
  return whole ? `${whole} ${n}/${d}` : `${n}/${d}`;
}

/** Pitch amounts offered in the editor, as entered text: 0, 1/16, 1/8, … 1 15/16, 2. */
export const PITCH_AMOUNTS: string[] = Array.from({ length: PITCH_MAX * PITCH_STEP_DENOMINATOR + 1 }, (_, i) => sixteenths(i));

/** Decimal shown beside a fraction in the pickers, to three places with halves rounded to even (1/16 is 0.062). */
export function decimalHint(text: string): string {
  const parsed = parseMeasurement(text);
  if (!parsed.ok) return '';
  const thousandths = (parsed.value.n * 1000) / parsed.value.d;
  const floor = Math.floor(thousandths);
  const diff = thousandths - floor;
  const rounded = diff > 0.5 || (diff === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
  return (rounded / 1000).toFixed(3);
}

/** The two span wheels: whole inches, and the sixteenths on top of them. */
export const SPAN_WHOLES: string[] = Array.from({ length: SPAN_MAX - SPAN_MIN + 1 }, (_, i) => String(SPAN_MIN + i));
export const SPAN_FRACTIONS: string[] = Array.from({ length: 16 }, (_, i) => (i === 0 ? '0' : sixteenths(i)));

/** Splits a span such as "4 3/8" into its wheels; null when it isn't on them. */
export function splitSpan(text: string): { whole: string; fraction: string } | null {
  const parsed = parseMeasurement(text);
  if (!parsed.ok || spanRangeError(parsed.value)) return null;
  const { n, d } = parsed.value;
  const whole = Math.floor(n / d);
  return { whole: String(whole), fraction: sixteenths(((n - whole * d) * 16) / d) };
}

export function joinSpan(whole: string, fraction: string): string {
  if (!whole) return '';
  if (whole === String(SPAN_MAX) || !fraction || fraction === '0') return whole;
  return `${whole} ${fraction}`;
}

/** Longest P.A.P horizontal offered, in inches. */
export const PAP_MAX = 8;

/** Any amount in sixteenths split for two wheels; null when it isn't on a 1/16 step. */
export function splitInches(text: string): { whole: string; fraction: string } | null {
  const parsed = parseMeasurement(text);
  if (!parsed.ok || 16 % parsed.value.d !== 0) return null;
  const { n, d } = parsed.value;
  const whole = Math.floor(n / d);
  return { whole: String(whole), fraction: sixteenths(((n - whole * d) * 16) / d) };
}

/** Joins two wheels into an amount; the top whole inch takes no fraction. */
export function joinInches(whole: string, fraction: string, max: number): string {
  if (!whole) return '';
  const hasFraction = fraction && fraction !== '0' && Number(whole) < max;
  if (whole === '0') return hasFraction ? fraction : '0';
  return hasFraction ? `${whole} ${fraction}` : whole;
}

/** The P.A.P as bowlers say it, e.g. "5 1/2 over, 1/2 up". */
export function papText(horizontal: string | null, vertical: string | null, dir: string | undefined): string {
  const parts: string[] = [];
  if (horizontal) parts.push(`${horizontal} over`);
  if (vertical) parts.push(dir === 'up' || dir === 'down' ? `${vertical} ${dir}` : vertical);
  return parts.join(', ');
}

function pitchRangeError(value: Rational): string | null {
  if (value.n > PITCH_MAX * value.d) return `Pitch must be between 0 and ${PITCH_MAX} inches`;
  if (PITCH_STEP_DENOMINATOR % value.d !== 0) return `Use steps of 1/${PITCH_STEP_DENOMINATOR} inch`;
  return null;
}

function spanRangeError(value: Rational): string | null {
  if (value.n < SPAN_MIN * value.d || value.n > SPAN_MAX * value.d) return `Span must be between ${SPAN_MIN} and ${SPAN_MAX} inches`;
  if (16 % value.d !== 0) return 'Use steps of 1/16 inch';
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
    if (f.kind === 'enum_thumb_insert' && trimmed && !(THUMB_INSERT_TYPES as readonly string[]).includes(trimmed))
      errors[f.key] = `Choose ${THUMB_INSERT_TYPES.join(', ')}`;
    if (f.kind === 'enum_grips' && trimmed && !(trimmed in GRIPS_LABELS)) errors[f.key] = 'Choose grips or no grips';
    if (f.kind === 'enum_grip_type' && trimmed && !(trimmed in GRIP_TYPE_LABELS)) errors[f.key] = `Choose ${Object.values(GRIP_TYPE_LABELS).join(', ')}`;
    if (f.kind === 'enum_play_style' && trimmed && !(trimmed in PLAY_STYLE_LABELS)) errors[f.key] = 'Choose one or two handed';
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
    const options = pickerOptions(f.key, draft);
    const statRange = STAT_RANGES[f.key];
    const rangeError = statRange
      ? parsed.value.n > statRange[1] * parsed.value.d
        ? `Enter ${statRange[0]} to ${statRange[1]}`
        : null
      : f.kind === 'pitch_ud'
      ? parsed.value.n > 2 * parsed.value.d || 16 % parsed.value.d !== 0
        ? 'Choose 0 to 2 inches in 1/16 steps'
        : null
      : f.key === 'pap_horizontal'
      ? parsed.value.n > PAP_MAX * parsed.value.d || 16 % parsed.value.d !== 0
        ? `Choose 0 to ${PAP_MAX} inches in 1/16 steps`
        : null
      : isPitchKind(f.kind)
      ? pitchRangeError(parsed.value)
      : (SPAN_FIELDS as readonly FieldKey[]).includes(f.key)
        ? spanRangeError(parsed.value)
        : options && !options.some((o) => sameAmount(o, parsed.value))
          ? `Choose ${options.length > 8 ? `from ${options[0]} to ${options[options.length - 1]}` : options.join(', ')}`
          : null;
    if (rangeError) {
      errors[f.key] = rangeError;
      continue;
    }
    if (isPitchKind(f.kind) && parsed.value.n !== 0 && (!dir || dir === 'none')) {
      errors[f.key] =
        f.kind === 'pitch_lateral' ? 'Choose left or right' : f.kind === 'pitch_ud' ? 'Choose up or down' : 'Choose forward or reverse';
    }
  }
  if (draft.finger_grips.text !== 'grips') {
    for (const key of ['grip_type', 'middle_grip_size', 'ring_grip_size'] as const) {
      if (draft[key].text.trim() !== '' && !errors[key]) errors[key] = 'Only used with grips';
    }
  }
  if (isInterchangeable(draft.thumb_insert_type.text.trim())) {
    for (const key of ['thumb_hole', 'thumb_od'] as const) {
      if (draft[key].text.trim() !== '' && !errors[key]) errors[key] = 'Not used with an interchangeable thumb insert';
    }
  }
  return errors;
}

function sameAmount(text: string, value: Rational): boolean {
  const p = parseMeasurement(text);
  return p.ok && p.value.n * value.d === value.n * p.value.d;
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
  up: 'Up',
  down: 'Down',
  none: 'Neutral',
};

export function directionLabel(dir: string): string {
  return DIR_LABELS[dir] ?? dir;
}

export const HAND_LABELS: Record<Hand, string> = { right: 'Right-handed', left: 'Left-handed' };
export const THUMB_MODE_LABELS: Record<ThumbMode, string> = { thumb_in: 'Thumb-in', no_thumb: 'No-thumb' };
export const SPAN_TYPE_LABELS: Record<SpanType, string> = {
  full_span: 'Full Span',
  cut_to_cut: 'Cut to Cut',
  cut_to_outer: 'Cut to Outer',
};
/** Letters on the sheet's span type picker, in picker order. */
export const SPAN_TYPE_ORDER: SpanType[] = ['full_span', 'cut_to_cut', 'cut_to_outer'];
export const SPAN_TYPE_LETTERS: Record<SpanType, string> = { full_span: 'F', cut_to_cut: 'C', cut_to_outer: 'CTO' };
/** What each span type measures, for the editor. */
export const SPAN_TYPE_HINTS: Record<SpanType, string> = {
  full_span: 'grip to thumb cut',
  cut_to_cut: 'cut of finger hole to cut of thumb hole',
  cut_to_outer: 'cut of finger hole to outer edge of thumb hole',
};
/** Thumb insert types offered in the editor, saved as shown. */
export const THUMB_INSERT_TYPES = ['IT', 'JOPO', 'Turbo', 'Turbo NX', 'Thumb Slug'] as const;

/** Plain-text value for display, history and print; null when not recorded. */
export function formatValue(key: FieldKey, value: Snapshot[FieldKey], opts: { unit?: boolean } = {}): string | null {
  if (value == null) return null;
  const f = FIELD_BY_KEY[key];
  if (typeof value === 'string') {
    if (f.kind === 'enum_hand') return HAND_LABELS[value as Hand] ?? value;
    if (f.kind === 'enum_thumb_mode') return THUMB_MODE_LABELS[value as ThumbMode] ?? value;
    if (f.kind === 'enum_span_type') return SPAN_TYPE_LABELS[value as SpanType] ?? value;
    if (f.kind === 'enum_grips') return GRIPS_LABELS[value as Grips] ?? value;
    if (f.kind === 'enum_grip_type') return GRIP_TYPE_LABELS[value as GripType] ?? value;
    if (f.kind === 'enum_play_style') return PLAY_STYLE_LABELS[value as PlayStyle] ?? value;
    return value;
  }
  if (key === 'middle_grip_size' || key === 'ring_grip_size') {
    const num = gripNumber(value.entered);
    if (num != null) return `${value.entered}${opts.unit ? '"' : ''} (${num})`;
  }
  const unit = opts.unit && f.unit ? (f.unit === '°' ? '°' : f.unit === 'in' ? '"' : ` ${f.unit}`) : '';
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
  if ((key === 'thumb_hole' || key === 'thumb_od') && isInterchangeable(snapshot?.thumb_insert_type as string | null)) return true;
  return !!FIELD_BY_KEY[key].thumbDependent && snapshot?.thumb_mode === 'no_thumb';
}

/**
 * Snapshots saved before each span type had its own fields kept every span in
 * the cut-to-cut keys, labelled by span_type. Move those to the right keys.
 */
export function upgradeSnapshot(snapshot: Snapshot): Snapshot {
  const s = snapshot as Record<string, Snapshot[FieldKey] | undefined>;
  const type = s.span_type;
  if (s.middle_full_span !== undefined || (type !== 'full_span' && type !== 'cut_to_outer')) return snapshot;
  const out = { ...snapshot } as Record<FieldKey, Snapshot[FieldKey]>;
  for (const finger of ['middle', 'ring'] as const) {
    out[spanField(finger, type)] = out[`${finger}_cut_to_cut`] ?? null;
    out[`${finger}_cut_to_cut`] = null;
  }
  return out as Snapshot;
}

/** What a draft field currently shows on the sheet; null when blank. */
export function parseDisplayDraft(draft: Draft, key: FieldKey): { text: string; dir?: string } | null {
  const f = FIELD_BY_KEY[key];
  const text = draft[key].text.trim();
  if (text === '') return null;
  if (f.kind === 'enum_hand') return { text: HAND_LABELS[text as Hand] ?? text };
  if (f.kind === 'enum_thumb_mode') return { text: THUMB_MODE_LABELS[text as ThumbMode] ?? text };
  if (f.kind === 'enum_span_type') return { text: SPAN_TYPE_LABELS[text as SpanType] ?? text };
  if (f.kind === 'enum_grips') return { text: GRIPS_LABELS[text as Grips] ?? text };
  if (f.kind === 'enum_grip_type') return { text: GRIP_TYPE_LABELS[text as GripType] ?? text };
  if (f.kind === 'enum_play_style') return { text: PLAY_STYLE_LABELS[text as PlayStyle] ?? text };
  if ((key === 'middle_grip_size' || key === 'ring_grip_size') && gripNumber(text) != null) return { text: `${text} (${gripNumber(text)})` };
  if (isPitchKind(f.kind)) return { text, dir: draft[key].dir || undefined };
  return { text };
}
