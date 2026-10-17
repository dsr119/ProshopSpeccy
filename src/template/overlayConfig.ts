// Where each measurement appears on specSheet550wide.png. Coordinates are in
// the image's intrinsic 550 x 550 pixel space and are converted to percentages
// at render time, so the overlay scales with the image.
//
// PROVISIONAL MAPPING (owner decision still open): the template does not say
// which upper hole is the middle finger or which way the sheet is viewed. We
// assume the sheet is viewed from above the ball with the thumb hole toward the
// bowler, the LEFT upper hole is the MIDDLE finger and the RIGHT upper hole is
// the RING finger, for both hands. The layout is never mirrored automatically
// for left-handed bowlers. To change the mapping, edit FINGER_MAPPING below.

import type { FieldKey } from '../measurements/schema';

export const TEMPLATE_SRC = `${import.meta.env.BASE_URL}assets/specSheet550wide.png`;
export const TEMPLATE_SIZE = 550;

export const FINGER_MAPPING = {
  provisional: true,
  leftUpperHole: 'middle',
  rightUpperHole: 'ring',
  viewDescription: 'Viewed from above the ball, thumb hole toward the bowler',
} as const;

export type SlotStyle = 'box' | 'hole' | 'pitch' | 'angle';

export interface OverlaySlot {
  field: FieldKey;
  style: SlotStyle;
  /** Pitch boxes sit on the arrow they stand for and only show a value pitched that way. */
  dir?: 'forward' | 'reverse' | 'left' | 'right';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayLabel {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Bounding boxes measured from the template artwork.
// Lateral boxes sit in the gaps above the left and right arrows, clear of the finger hole.
const LEFT = { ovalX: 127, holeCx: 175, crossX: 4, cutX: 137, actualX: 155, latLeft: [8, 54], latRight: [74, 50] };
const RIGHT = { ovalX: 327, holeCx: 375, crossX: 432, cutX: 316, actualX: 298, latLeft: [424, 50], latRight: [486, 56] };
const finger = (side: 'left' | 'right') => (FINGER_MAPPING[side === 'left' ? 'leftUpperHole' : 'rightUpperHole']);

function fingerSlots(side: 'left' | 'right'): OverlaySlot[] {
  const g = side === 'left' ? LEFT : RIGHT;
  const f = finger(side);
  return [
    { field: `${f}_oval`, style: 'box', x: g.ovalX, y: 32, w: 96, h: 31 },
    { field: `${f}_hole`, style: 'hole', x: g.holeCx - 42, y: 110, w: 84, h: 34 },
    { field: `${f}_fr_pitch`, style: 'pitch', dir: 'forward', x: g.crossX, y: 46, w: 114, h: 28 },
    { field: `${f}_fr_pitch`, style: 'pitch', dir: 'reverse', x: g.crossX, y: 176, w: 114, h: 28 },
    { field: `${f}_lateral_pitch`, style: 'pitch', dir: 'left', x: g.latLeft[0], y: 93, w: g.latLeft[1], h: 20 },
    { field: `${f}_lateral_pitch`, style: 'pitch', dir: 'right', x: g.latRight[0], y: 93, w: g.latRight[1], h: 20 },
    { field: `${f}_cut_to_cut`, style: 'box', x: g.cutX, y: 222, w: 96, h: 31 },
    { field: `${f}_actual_cut`, style: 'box', x: g.actualX, y: 292, w: 96, h: 31 },
  ] as OverlaySlot[];
}

export const OVERLAY_SLOTS: OverlaySlot[] = [
  ...fingerSlots('left'),
  ...fingerSlots('right'),
  { field: 'thumb_hole', style: 'hole', x: 233, y: 410, w: 84, h: 34 },
  { field: 'thumb_oval', style: 'box', x: 227, y: 487, w: 96, h: 31 },
  { field: 'thumb_fr_pitch', style: 'pitch', dir: 'forward', x: 102, y: 346, w: 116, h: 28 },
  { field: 'thumb_fr_pitch', style: 'pitch', dir: 'reverse', x: 102, y: 474, w: 116, h: 28 },
  { field: 'thumb_lateral_pitch', style: 'pitch', dir: 'left', x: 110, y: 397, w: 52, h: 22 },
  { field: 'thumb_lateral_pitch', style: 'pitch', dir: 'right', x: 176, y: 397, w: 50, h: 22 },
  { field: 'thumb_oval_angle', style: 'angle', x: 335, y: 488, w: 75, h: 28 },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const OVERLAY_LABELS: OverlayLabel[] = [
  { text: cap(finger('left')), x: LEFT.holeCx - 35, y: 86, w: 70, h: 18 },
  { text: cap(finger('right')), x: RIGHT.holeCx - 35, y: 86, w: 70, h: 18 },
  { text: 'Thumb', x: 240, y: 386, w: 70, h: 18 },
];

/** Covers the printed "Cut to Cut" heading so it can name the chosen span type instead. */
export const SPAN_HEADING: Omit<OverlayLabel, 'text'> = { x: 200, y: 201, w: 150, h: 18 };

export const pct = (v: number) => `${(v / TEMPLATE_SIZE) * 100}%`;
