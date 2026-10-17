import { describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  draftToSnapshot,
  emptySnapshot,
  formatValue,
  isNotApplicable,
  snapshotToDraft,
  snapshotToPayload,
  validateDraft,
  type Draft,
} from './schema';

function draftWith(values: Partial<Record<keyof Draft, { text: string; dir?: string }>>): Draft {
  const d = snapshotToDraft(null);
  for (const [k, v] of Object.entries(values)) d[k as keyof Draft] = { text: v!.text, dir: v!.dir ?? '' };
  return d;
}

describe('measurement schema', () => {
  it('keeps blank and zero distinct', () => {
    const s = draftToSnapshot(draftWith({ middle_hole: { text: '0' }, ring_hole: { text: '' } }));
    expect(s.middle_hole).toEqual({ entered: '0', n: 0, d: 1 });
    expect(s.ring_hole).toBeNull();
    expect(formatValue('middle_hole', s.middle_hole)).toBe('0');
    expect(formatValue('ring_hole', s.ring_hole)).toBeNull();
  });

  it('preserves entered notation alongside the exact value', () => {
    const s = draftToSnapshot(draftWith({ middle_cut_to_cut: { text: ' 4  3/8 ' } }));
    expect(s.middle_cut_to_cut).toEqual({ entered: '4 3/8', n: 35, d: 8 });
  });

  it('requires a direction for non-zero pitch and allows neutral zero', () => {
    expect(validateDraft(draftWith({ middle_lateral_pitch: { text: '1/8' } })).middle_lateral_pitch).toMatch(/left or right/);
    expect(validateDraft(draftWith({ thumb_fr_pitch: { text: '1/8', dir: 'none' } })).thumb_fr_pitch).toMatch(/forward or reverse/);
    expect(validateDraft(draftWith({ ring_lateral_pitch: { text: '0', dir: 'none' } }))).toEqual({});
    expect(validateDraft(draftWith({ ring_lateral_pitch: { text: '', dir: 'left' } })).ring_lateral_pitch).toMatch(/amount/);
    const s = draftToSnapshot(draftWith({ middle_lateral_pitch: { text: '1/8', dir: 'right' } }));
    expect(s.middle_lateral_pitch).toEqual({ entered: '1/8', n: 1, d: 8, dir: 'right' });
    expect(formatValue('middle_lateral_pitch', s.middle_lateral_pitch)).toBe('1/8 Right');
  });

  it('reports errors without changing the draft', () => {
    const d = draftWith({ middle_hole: { text: '4 3/0' }, thumb_hole: { text: '-1' } });
    const before = JSON.stringify(d);
    const errors = validateDraft(d);
    expect(Object.keys(errors).sort()).toEqual(['middle_hole', 'thumb_hole']);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('allows a signed oval angle only', () => {
    expect(validateDraft(draftWith({ thumb_oval_angle: { text: '-10' } }))).toEqual({});
    expect(validateDraft(draftWith({ thumb_hole: { text: '-10' } })).thumb_hole).toMatch(/negative/);
  });

  it('round-trips through the save payload', () => {
    const d = draftWith({ hand: { text: 'left' }, thumb_mode: { text: 'no_thumb' }, thumb_hole: { text: '1 1/16' }, fitting_notes: { text: 'x' } });
    const s = draftToSnapshot(d);
    const payload = snapshotToPayload(s);
    expect(payload.thumb_hole).toEqual({ entered: '1 1/16' });
    expect(payload.hand).toBe('left');
    expect(snapshotToDraft(s)).toEqual(d);
  });

  it('keeps thumb values in no-thumb mode but marks them not applicable', () => {
    const s = draftToSnapshot(draftWith({ thumb_mode: { text: 'no_thumb' }, thumb_hole: { text: '1' } }));
    expect(s.thumb_hole).not.toBeNull();
    expect(isNotApplicable('thumb_hole', s)).toBe(true);
    expect(isNotApplicable('middle_cut_to_cut', s)).toBe(true);
    expect(isNotApplicable('middle_hole', s)).toBe(false);
  });

  it('lists changed fields', () => {
    const a = emptySnapshot();
    const b = draftToSnapshot(draftWith({ ring_hole: { text: '3/4' } }));
    expect(diffSnapshots(a, b)).toEqual([{ key: 'ring_hole', before: null, after: '3/4' }]);
  });
});
