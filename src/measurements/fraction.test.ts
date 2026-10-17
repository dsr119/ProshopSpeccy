import { describe, expect, it } from 'vitest';
import { parseMeasurement } from './fraction';

// The same cases are checked against the database parser in supabase/tests.
const valid: Array<[string, boolean, number, number]> = [
  ['4 3/8', false, 35, 8],
  ['4-3/8', false, 35, 8],
  ['4 - 3/8', false, 35, 8],
  ['3/8', false, 3, 8],
  ['3 / 8', false, 3, 8],
  ['4.375', false, 35, 8],
  ['.375', false, 3, 8],
  ['4', false, 4, 1],
  ['0', false, 0, 1],
  ['0/8', false, 0, 1],
  ['0.0', false, 0, 1],
  ['6/8', false, 3, 4],
  ['9/8', false, 9, 8],
  ['  4   3/8  ', false, 35, 8],
  ['4 3/8"', false, 35, 8],
  ['4 3/8 in', false, 35, 8],
  ['15°', true, 15, 1],
  ['-10', true, -10, 1],
  ['-0', true, 0, 1],
  ['55/64', false, 55, 64],
  ['1 1/16', false, 17, 16],
];

const invalid: Array<[string, boolean, RegExp]> = [
  ['', false, /blank/],
  ['   ', false, /blank/],
  ['3/0', false, /cannot be zero/],
  ['4 3/0', false, /cannot be zero/],
  ['4 9/8', false, /less than 1/],
  ['-1/8', false, /negative/],
  ['abc', false, /not a number/],
  ['4 3/8/2', false, /not a number/],
  ['4.', false, /not a number/],
  ['1.2.3', false, /not a number/],
  ['4 3', false, /not a number/],
  ['1e3', false, /not a number/],
  ['3/8 4', false, /not a number/],
  ['1234567', false, /not a number/],
];

describe('parseMeasurement', () => {
  it.each(valid)('parses %j', (input, signed, n, d) => {
    expect(parseMeasurement(input, signed)).toEqual({ ok: true, value: { n, d } });
  });

  it.each(invalid)('rejects %j', (input, signed, message) => {
    const result = parseMeasurement(input, signed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it('never rounds through floating point', () => {
    expect(parseMeasurement('0.1')).toEqual({ ok: true, value: { n: 1, d: 10 } });
    expect(parseMeasurement('4.333333')).toEqual({ ok: true, value: { n: 4333333, d: 1000000 } });
  });
});
