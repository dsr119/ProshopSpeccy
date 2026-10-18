import { describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  draftToSnapshot,
  emptySnapshot,
  formatValue,
  isNotApplicable,
  PITCH_AMOUNTS,
  BRIDGE_SIZES,
  GRIP_SIZES,
  HOLE_SIZES,
  spanField,
  papText,
  joinInches,
  splitInches,
  upgradeSnapshot,
  type Snapshot,
  SPAN_FRACTIONS,
  SPAN_WHOLES,
  decimalHint,
  joinSpan,
  splitSpan,
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

  it('saves each span type separately and reads older span-typed snapshots', () => {
    const d = draftWith({ span_type: { text: 'cut_to_outer' }, middle_cut_to_cut: { text: '4 3/8' }, middle_cut_to_outer: { text: '5' } });
    expect(validateDraft(d)).toEqual({});
    const s = draftToSnapshot(d);
    expect(formatValue('span_type', s.span_type)).toBe('Cut to Outer');
    expect(formatValue('middle_cut_to_cut', s.middle_cut_to_cut)).toBe('4 3/8');
    expect(formatValue('middle_cut_to_outer', s.middle_cut_to_outer)).toBe('5');
    expect(spanField('ring', 'full_span')).toBe('ring_full_span');
    expect(spanField('ring', '')).toBe('ring_cut_to_cut');
    // Before each type had its own keys, a full span was kept in the cut-to-cut keys.
    const old = { ...emptySnapshot(), span_type: 'full_span', middle_cut_to_cut: { entered: '4 3/16', n: 67, d: 16 } } as Record<string, unknown>;
    delete old.middle_full_span;
    const up = upgradeSnapshot(old as unknown as Snapshot);
    expect(up.middle_full_span).toEqual({ entered: '4 3/16', n: 67, d: 16 });
    expect(up.middle_cut_to_cut).toBeNull();
  });

  it('limits holes, grips, bridge and slug sizes to their lists', () => {
    expect(HOLE_SIZES[0]).toBe('1/4');
    expect(HOLE_SIZES.at(-1)).toBe('1 1/4');
    expect(HOLE_SIZES).toHaveLength(65);
    expect(GRIP_SIZES[0]).toEqual(['17/32', '-1']);
    expect(GRIP_SIZES[2]).toEqual(['9/16', '0']);
    expect(GRIP_SIZES.at(-2)).toEqual(['7/8', '10']);
    expect(GRIP_SIZES.at(-1)).toEqual(['29/32', '11']);
    expect(BRIDGE_SIZES).toEqual(['1/8', '3/16', '1/4', '5/16', '3/8', '7/16', '1/2']);
    expect(validateDraft(draftWith({ middle_hole: { text: '55/64' } }))).toEqual({});
    expect(validateDraft(draftWith({ middle_hole: { text: '1 5/16' } })).middle_hole).toMatch(/1\/4 to 1 1\/4/);
    // With grips the finger hole is one of three sizes, and the grip size comes from the grip list.
    const grips = { finger_grips: { text: 'grips' }, grip_type: { text: 'vaccu' } };
    expect(validateDraft(draftWith({ ...grips, middle_hole: { text: '31/32' }, middle_grip_size: { text: '37/64' } }))).toEqual({});
    expect(validateDraft(draftWith({ ...grips, middle_hole: { text: '55/64' } })).middle_hole).toMatch(/7\/8, 31\/32, 1 1\/32/);
    expect(validateDraft(draftWith({ middle_grip_size: { text: '37/64' } })).middle_grip_size).toMatch(/grips/);
    expect(formatValue('middle_grip_size', { entered: '37/64', n: 37, d: 64 })).toBe('37/64 (0.5)');
    expect(validateDraft(draftWith({ bridge: { text: '9/16' } })).bridge).toBeDefined();
    // Interchangeable thumb inserts take no hole or slug size; a thumb slug does.
    expect(validateDraft(draftWith({ thumb_insert_type: { text: 'JOPO' }, thumb_hole: { text: '1' } })).thumb_hole).toMatch(/interchangeable/);
    expect(validateDraft(draftWith({ thumb_insert_type: { text: 'Thumb Slug' }, thumb_hole: { text: '1' }, thumb_od: { text: '1 1/8' } }))).toEqual({});
    expect(validateDraft(draftWith({ thumb_od: { text: '1' } })).thumb_od).toMatch(/7\/8, 1 1\/8/);
  });

  it('records ball motion, one or two handed, and who wrote the specs', () => {
    const d = draftWith({
      play_style: { text: 'two_handed' },
      rev_rate: { text: '450' },
      axis_rotation: { text: '45' },
      axis_tilt: { text: '12.5' },
      speed: { text: '17.2' },
      pap_horizontal: { text: '5 1/2' },
      pap_vertical: { text: '1/2', dir: 'up' },
      written_by: { text: 'Pat' },
    });
    expect(validateDraft(d)).toEqual({});
    const s = draftToSnapshot(d);
    expect(formatValue('play_style', s.play_style)).toBe('Two Handed');
    expect(formatValue('rev_rate', s.rev_rate, { unit: true })).toBe('450 rpm');
    expect(formatValue('axis_tilt', s.axis_tilt, { unit: true })).toBe('12.5°');
    expect(formatValue('speed', s.speed, { unit: true })).toBe('17.2 mph');
    expect(formatValue('pap_vertical', s.pap_vertical)).toBe('1/2 Up');
    expect(papText('5 1/2', '1/2', 'up')).toBe('5 1/2 over, 1/2 up');
    expect(validateDraft(draftWith({ pap_vertical: { text: '1/4' } })).pap_vertical).toBe('Choose up or down');
    expect(validateDraft(draftWith({ pap_horizontal: { text: '8 1/16' } })).pap_horizontal).toMatch(/0 to 8/);
    expect(joinInches('0', '3/8', 2)).toBe('3/8');
    expect(joinInches('2', '3/8', 2)).toBe('2');
    expect(splitInches('5 1/2')).toEqual({ whole: '5', fraction: '1/2' });
    expect(validateDraft(draftWith({ axis_rotation: { text: '91' } })).axis_rotation).toBe('Enter 0 to 90');
    expect(validateDraft(draftWith({ speed: { text: '-3' } })).speed).toMatch(/negative/);
  });

  it('limits pitch to 0–2 inches in 1/16 steps', () => {
    expect(PITCH_AMOUNTS).toHaveLength(33);
    expect(PITCH_AMOUNTS.slice(0, 5)).toEqual(['0', '1/16', '1/8', '3/16', '1/4']);
    expect(PITCH_AMOUNTS.slice(-3)).toEqual(['1 7/8', '1 15/16', '2']);
    expect(validateDraft(draftWith({ middle_fr_pitch: { text: '2', dir: 'forward' } }))).toEqual({});
    expect(validateDraft(draftWith({ middle_fr_pitch: { text: '0.125', dir: 'reverse' } }))).toEqual({});
    expect(validateDraft(draftWith({ ring_lateral_pitch: { text: '2 1/16', dir: 'left' } })).ring_lateral_pitch).toMatch(/between 0 and 2/);
    expect(validateDraft(draftWith({ thumb_fr_pitch: { text: '1/32', dir: 'forward' } })).thumb_fr_pitch).toMatch(/1\/16/);
    for (const a of PITCH_AMOUNTS) expect(validateDraft(draftWith({ middle_lateral_pitch: { text: a, dir: 'left' } }))).toEqual({});
  });

  it('limits spans to 2–6 inches in 1/16 steps, picked on two wheels', () => {
    expect(SPAN_WHOLES).toEqual(['2', '3', '4', '5', '6']);
    expect(SPAN_FRACTIONS.slice(0, 3)).toEqual(['0', '1/16', '1/8']);
    expect(splitSpan('4 3/8')).toEqual({ whole: '4', fraction: '3/8' });
    expect(splitSpan('5')).toEqual({ whole: '5', fraction: '0' });
    expect(splitSpan('7')).toBeNull();
    expect(joinSpan('4', '3/8')).toBe('4 3/8');
    expect(joinSpan('4', '0')).toBe('4');
    expect(joinSpan('6', '1/2')).toBe('6');
    expect(joinSpan('', '1/2')).toBe('');
    const withSpan = (text: string) => validateDraft(draftWith({ span_type: { text: 'cut_to_cut' }, middle_cut_to_cut: { text } })).middle_cut_to_cut;
    expect(withSpan('4 15/16')).toBeUndefined();
    expect(withSpan('1 7/8')).toMatch(/between 2 and 6/);
    expect(withSpan('6 1/16')).toMatch(/between 2 and 6/);
    expect(withSpan('4 1/32')).toMatch(/1\/16/);
    expect(decimalHint('1/16')).toBe('0.062');
    expect(decimalHint('3/16')).toBe('0.188');
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
