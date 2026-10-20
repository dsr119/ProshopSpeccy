import { describe, expect, it } from 'vitest';
import { byLastName } from './names';

describe('byLastName', () => {
  it('sorts by last name, then first name', () => {
    expect(['Doug Smith', 'Keith Danielowski', 'Tim Bilski', 'Amy Danielowski', 'Kayla Wright'].sort(byLastName)).toEqual([
      'Tim Bilski',
      'Amy Danielowski',
      'Keith Danielowski',
      'Doug Smith',
      'Kayla Wright',
    ]);
  });
});
