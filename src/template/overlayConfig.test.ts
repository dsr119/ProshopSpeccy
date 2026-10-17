import { describe, expect, it } from 'vitest';
import { FIELDS } from '../measurements/schema';
import { OVERLAY_LABELS, OVERLAY_SLOTS, SPAN_HEADING, TEMPLATE_SIZE } from './overlayConfig';
import { fitFont } from './SpecSheet';

// The span type is shown as the span heading rather than in a box of its own.
const sheetFields = FIELDS.filter((f) => !['identity', 'details'].includes(f.group) && f.key !== 'span_type').map((f) => f.key);

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('overlay configuration', () => {
  it('places every sheet measurement exactly once', () => {
    const keys = OVERLAY_SLOTS.map((s) => s.field).sort();
    expect(keys).toEqual([...sheetFields].sort());
  });

  it('keeps every slot inside the 550 x 550 template', () => {
    for (const s of [...OVERLAY_SLOTS, ...OVERLAY_LABELS, SPAN_HEADING]) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(TEMPLATE_SIZE);
      expect(s.y + s.h).toBeLessThanOrEqual(TEMPLATE_SIZE);
    }
  });

  it('never overlaps two slots or a slot and a label', () => {
    const all = [...OVERLAY_SLOTS.map((s) => ({ ...s, id: s.field })), ...OVERLAY_LABELS.map((l) => ({ ...l, id: l.text }))];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i], all[j]), `${all[i].id} overlaps ${all[j].id}`).toBe(false);
      }
    }
  });

  it('shrinks or wraps long values instead of clipping', () => {
    const short = fitFont('4 3/8', 96, 31);
    expect(short.lines).toBe(1);
    const long = fitFont('Lat 1234567.123456 →Right', 114, 28);
    expect(long.size * 0.6 * 'Lat 1234567.123456 →Right'.length).toBeLessThanOrEqual((114 - 8) * long.lines + 0.001);
  });
});
