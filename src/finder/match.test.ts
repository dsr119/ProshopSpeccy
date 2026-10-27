import { describe, expect, it } from 'vitest';
import { EMPTY_BALL, hasMeasurements, measurementErrors, parseAmount, rankBowlers, scoreSheet, type FinderSheet, type SheetSpecs } from './match';
import { monthRange } from './api';

const num = (entered: string, n: number, d: number) => ({ entered, n, d });
const pitch = (entered: string, n: number, d: number, dir: string) => ({ entered, n, d, dir });

function sheet(customer: string, specs: SheetSpecs, extra: Partial<FinderSheet> = {}): FinderSheet {
  return {
    revision_id: `${customer}-${extra.revision_number ?? 1}`,
    customer_id: customer,
    name: customer,
    phone: null,
    revision_number: 1,
    is_current: true,
    specs,
    sheet_date: null,
    entered_at: '2026-05-01T12:00:00Z',
    ...extra,
  };
}

describe('scoreSheet', () => {
  it('scores an exact match as 100%', () => {
    const ball = { ...EMPTY_BALL, thumb_hole: '1', middle_span: '4 1/4' };
    const m = scoreSheet(ball, { thumb_hole: num('1', 1, 1), middle_cut_to_cut: num('4 1/4', 17, 4) });
    expect(m.percent).toBe(100);
    expect(m.compared).toBe(2);
  });

  it('falls off with distance up to the tolerance', () => {
    // A thumb hole 1/64 off is a quarter of the 1/16 tolerance.
    expect(scoreSheet({ ...EMPTY_BALL, thumb_hole: '1 1/64' }, { thumb_hole: num('1', 1, 1) }).percent).toBe(75);
    expect(scoreSheet({ ...EMPTY_BALL, thumb_hole: '1 1/8' }, { thumb_hole: num('1', 1, 1) }).percent).toBe(0);
  });

  it('gives half credit for a field the sheet left blank', () => {
    const m = scoreSheet({ ...EMPTY_BALL, thumb_hole: '1', bridge: '1/4' }, { thumb_hole: num('1', 1, 1) });
    expect(m.compared).toBe(1);
    expect(m.measured).toBe(2);
    // thumb 1.5 × 1 + bridge 0.5 × 0.5, over 2.
    expect(m.percent).toBe(88);
  });

  it('compares spans of the type measured', () => {
    const specs = { middle_cut_to_cut: num('4', 4, 1), middle_full_span: num('5', 5, 1) };
    expect(scoreSheet({ ...EMPTY_BALL, span_type: 'full_span', middle_span: '5' }, specs).percent).toBe(100);
    expect(scoreSheet({ ...EMPTY_BALL, span_type: 'cut_to_outer', middle_span: '5' }, specs).compared).toBe(0);
  });

  it('uses pitch direction only when the ball has one', () => {
    const specs = { thumb_lateral_pitch: pitch('1/8', 1, 8, 'left') };
    expect(scoreSheet({ ...EMPTY_BALL, thumb_lateral_pitch: { text: '1/8', dir: '' } }, specs).percent).toBe(100);
    expect(scoreSheet({ ...EMPTY_BALL, thumb_lateral_pitch: { text: '1/8', dir: 'left' } }, specs).percent).toBe(100);
    // Opposite way is 1/4 apart, the full tolerance.
    expect(scoreSheet({ ...EMPTY_BALL, thumb_lateral_pitch: { text: '1/8', dir: 'right' } }, specs).percent).toBe(0);
  });

  it('matches choices exactly', () => {
    expect(scoreSheet({ ...EMPTY_BALL, finger_grips: 'grips' }, { finger_grips: 'grips' }).percent).toBe(100);
    expect(scoreSheet({ ...EMPTY_BALL, finger_grips: 'grips' }, { finger_grips: 'no_grips' }).percent).toBe(0);
  });
});

describe('measurements', () => {
  it('ignores blank and unreadable values and reports the unreadable ones', () => {
    expect(hasMeasurements(EMPTY_BALL)).toBe(false);
    const ball = { ...EMPTY_BALL, thumb_hole: 'abc' };
    expect(hasMeasurements(ball)).toBe(false);
    expect(measurementErrors(ball).thumb_hole).toMatch(/not a number/);
  });
});

describe('rankBowlers', () => {
  const ball = { ...EMPTY_BALL, thumb_hole: '1', middle_span: '4 1/4', ring_span: '4 3/8' };

  it('lists the closest bowler first and keeps each bowler once, by their best version', () => {
    const ranked = rankBowlers(ball, [
      sheet('far', { thumb_hole: num('1 1/16', 17, 16), middle_cut_to_cut: num('4 1/2', 9, 2) }),
      sheet('close', { thumb_hole: num('1', 1, 1), middle_cut_to_cut: num('4 1/4', 17, 4), ring_cut_to_cut: num('4 3/8', 35, 8) }, { is_current: false }),
      sheet('close', { thumb_hole: num('1 1/32', 33, 32), middle_cut_to_cut: num('4 1/2', 9, 2) }, { revision_number: 2 }),
      sheet('nothing', { bridge: num('1/4', 1, 4) }),
    ]);
    expect(ranked.map((r) => r.sheet.customer_id)).toEqual(['close', 'far']);
    expect(ranked[0].percent).toBe(100);
    expect(ranked[0].versions).toBe(2);
    expect(ranked[0].sheet.revision_number).toBe(1);
  });

  it('prefers a sheet that has more of the measurements', () => {
    const ranked = rankBowlers(ball, [
      sheet('one', { thumb_hole: num('1', 1, 1) }),
      sheet('three', { thumb_hole: num('1', 1, 1), middle_cut_to_cut: num('4 1/4', 17, 4), ring_cut_to_cut: num('4 3/8', 35, 8) }),
    ]);
    expect(ranked[0].sheet.customer_id).toBe('three');
  });
});

describe('ranges', () => {
  it('reads a range typed with to, a spaced dash or an en dash, either way round', () => {
    expect(parseAmount('3 7/8 to 4 5/16')).toEqual({ lo: 3.875, hi: 4.3125, range: true });
    expect(parseAmount('4 5/16 - 3 7/8')).toEqual({ lo: 3.875, hi: 4.3125, range: true });
    expect(parseAmount('3 7/8–4 5/16')).toEqual({ lo: 3.875, hi: 4.3125, range: true });
    // A dash with no spaces is still a mixed number.
    expect(parseAmount('4-3/8')).toEqual({ lo: 4.375, hi: 4.375, range: false });
    expect(parseAmount('3 7/8 to abc')).toMatchObject({ error: expect.stringMatching(/not a number/) });
  });

  it('keeps only sheets inside the range, scoring them 100% on it', () => {
    const ball = { ...EMPTY_BALL, middle_span: '3 7/8 to 4 5/16', thumb_hole: '1' };
    const ranked = rankBowlers(ball, [
      sheet('inside', { middle_cut_to_cut: num('4 1/8', 33, 8), thumb_hole: num('1', 1, 1) }),
      sheet('edge', { middle_cut_to_cut: num('4 5/16', 69, 16), thumb_hole: num('1 1/64', 65, 64) }),
      sheet('outside', { middle_cut_to_cut: num('4 3/8', 35, 8), thumb_hole: num('1', 1, 1) }),
      sheet('blank', { thumb_hole: num('1', 1, 1) }),
    ]);
    expect(ranked.map((r) => r.sheet.customer_id)).toEqual(['inside', 'edge']);
    expect(ranked[0].percent).toBe(100);
  });

  it('works on pitches with a direction', () => {
    const ball = { ...EMPTY_BALL, thumb_lateral_pitch: { text: '1/8 to 1/4', dir: 'left' } };
    expect(scoreSheet(ball, { thumb_lateral_pitch: pitch('3/16', 3, 16, 'left') }).excluded).toBe(false);
    expect(scoreSheet(ball, { thumb_lateral_pitch: pitch('3/16', 3, 16, 'right') }).excluded).toBe(true);
  });
});

describe('monthRange', () => {
  it('covers the whole month', () => {
    expect(monthRange('2026-05')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('')).toBeNull();
  });
});
