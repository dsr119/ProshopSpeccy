// Parses measurements as staff type them ("4 3/8", "3/8", "4.375", "4-3/8")
// into exact reduced fractions. Mirrors private.parse_measurement() in
// supabase/migrations/20261017042852_fits_and_revisions.sql; keep them in step.

export interface Rational {
  n: number;
  d: number;
}

export type ParseResult = { ok: true; value: Rational } | { ok: false; error: string };

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function parseMeasurement(input: string, signed = false): ParseResult {
  let v = input.trim().toLowerCase();
  v = v.replace(/\s*(inches|inch|in|"|''|degrees|degree|deg|°)$/, '').trim();
  v = v.replace(/\s+/g, ' ');
  if (v === '') return { ok: false, error: 'Enter a number or leave it blank' };

  let negative = false;
  if (v.startsWith('-')) {
    if (!signed) return { ok: false, error: 'Cannot be negative' };
    negative = true;
    v = v.slice(1).trim();
  }

  let num: number;
  let den: number;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^\d{1,6}$/))) {
    num = Number(v);
    den = 1;
  } else if ((m = v.match(/^(\d{0,6})\.(\d{1,6})$/))) {
    den = 10 ** m[2].length;
    num = Number(m[1] || '0') * den + Number(m[2]);
  } else if ((m = v.match(/^(\d{1,6}) ?\/ ?(\d{1,6})$/))) {
    num = Number(m[1]);
    den = Number(m[2]);
    if (den === 0) return { ok: false, error: 'The bottom of a fraction cannot be zero' };
  } else if ((m = v.match(/^(\d{1,6})(?: |-| - )(\d{1,6}) ?\/ ?(\d{1,6})$/))) {
    const whole = Number(m[1]);
    num = Number(m[2]);
    den = Number(m[3]);
    if (den === 0) return { ok: false, error: 'The bottom of a fraction cannot be zero' };
    if (num >= den) return { ok: false, error: 'In a mixed number like 4 3/8 the fraction must be less than 1' };
    num = whole * den + num;
  } else {
    return { ok: false, error: `"${input.trim()}" is not a number. Use forms like 4 3/8, 3/8 or 4.375` };
  }

  const g = gcd(num, den);
  if (g > 1) {
    num /= g;
    den /= g;
  }
  if (num === 0) {
    den = 1;
    negative = false;
  }
  return { ok: true, value: { n: negative ? -num : num, d: den } };
}

export function rationalToNumber(r: Rational): number {
  return r.n / r.d;
}

export function rationalsEqual(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}
