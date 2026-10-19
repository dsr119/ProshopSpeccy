import { describe, expect, it } from 'vitest';
import { readingDraft, type IntakeItem } from './api';

const item = (read_sheet: IntakeItem['read_sheet']) => ({ read_sheet }) as IntakeItem;

describe('readingDraft', () => {
  it('keeps known fields and allowed choices only', () => {
    const r = readingDraft(
      item({
        fields: {
          hand: { text: 'left', dir: '' },
          span_type: { text: 'sideways', dir: '' },
          middle_hole: { text: ' 31/32 ', dir: 'up' },
          middle_lateral_pitch: { text: '3/8', dir: 'left' },
          ring_fr_pitch: { text: '1/8', dir: 'left' },
          shoe_size: { text: '11', dir: '' },
          bridge: { text: '', dir: '' },
        },
        unsure: ['middle_hole'],
      }),
    );
    expect(r?.draft).toEqual({
      hand: { text: 'left', dir: '' },
      middle_hole: { text: '31/32', dir: '' },
      middle_lateral_pitch: { text: '3/8', dir: 'left' },
      ring_fr_pitch: { text: '1/8', dir: '' },
    });
    expect(r?.unsure).toEqual(['middle_hole']);
  });

  it('gives nothing for a sheet not read yet', () => {
    expect(readingDraft(item(null))).toBeUndefined();
  });
});
