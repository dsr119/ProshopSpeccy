import { describe, expect, it } from 'vitest';
import { FIELDS } from '../measurements/schema';
import { CHOICE_GROUPS, OVERLAY_SLOTS, SHEET_LABELS, TEMPLATE_H, TEMPLATE_W } from './overlayConfig';
import { fitFont, pitchText } from './SpecSheet';

// The span type is the lettered picker and grips are choice boxes; the full span and cut to outer values share
// the span boxes with cut to cut; the rest are kept in the record and the table but not drawn on the sheet.
const OFF_SHEET = new Set([
  'span_type',
  'finger_grips',
  'grip_type',
  'middle_full_span',
  'ring_full_span',
  'middle_cut_to_outer',
  'ring_cut_to_outer',
  'middle_oval',
  'ring_oval',
  'middle_actual_cut',
  'ring_actual_cut',
  'thumb_oval',
  'thumb_oval_angle',
]);
const sheetFields = FIELDS.filter((f) => !['identity', 'details'].includes(f.group) && !OFF_SHEET.has(f.key)).map((f) => f.key);

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('overlay configuration', () => {
  it('places every sheet measurement, with one box per pitch direction', () => {
    const keys = [...new Set(OVERLAY_SLOTS.map((s) => s.field))].sort();
    expect(keys).toEqual([...sheetFields].sort());
    const ids = OVERLAY_SLOTS.map((s) => `${s.field}:${s.dir ?? ''}:${s.when ?? ''}`);
    expect(CHOICE_GROUPS.map((g) => g.field)).toEqual(['finger_grips', 'grip_type']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every slot and label inside the sheet', () => {
    for (const s of OVERLAY_SLOTS) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(TEMPLATE_W);
      expect(s.y + s.h).toBeLessThanOrEqual(TEMPLATE_H);
    }
    for (const l of SHEET_LABELS) {
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(TEMPLATE_W);
      expect(l.y).toBeLessThan(TEMPLATE_H);
    }
  });

  it('never overlaps two slots or choice boxes shown together', () => {
    const boxes = [
      ...OVERLAY_SLOTS,
      ...CHOICE_GROUPS.flatMap((g) => g.options.map((o) => ({ ...o, field: `${g.field}:${o.value}`, when: undefined }))),
    ];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.when && b.when && a.when !== b.when) continue;
        expect(overlaps(a, b), `${a.field} overlaps ${b.field}`).toBe(false);
      }
    }
  });

  it('shrinks or wraps long values instead of clipping', () => {
    const short = fitFont('4 3/8', 96, 31);
    expect(short.lines).toBe(1);
    const long = fitFont('Lat 1234567.123456 →Right', 114, 28);
    expect(long.size * 0.6 * 'Lat 1234567.123456 →Right'.length).toBeLessThanOrEqual((114 - 8) * long.lines + 0.001);
  });

  it('prints pitches as fractions, signing finger lateral pitch', () => {
    expect(pitchText('3/8', 'forward', false)).toBe('3/8');
    expect(pitchText('1/4', 'left', true)).toBe('-1/4');
    expect(pitchText('1 1/32', 'right', true)).toBe('+1 1/32');
    expect(pitchText('0', 'none', true)).toBe('0');
  });
});
