// Layout of the spec sheet, drawn by SheetArtwork and filled by SpecSheet.
// Everything is in a 540 x 640 drawing space and converted to percentages at
// render time, so the sheet scales with its container. The layout follows the
// shop's own sheet mockup (October 2026).
//
// PROVISIONAL MAPPING (owner decision still open): we assume the sheet is
// viewed from above the ball with the thumb hole toward the bowler, the LEFT
// upper hole is the MIDDLE finger and the RIGHT upper hole is the RING finger,
// for both hands. The layout is never mirrored automatically for left-handed
// bowlers. To change the mapping, edit FINGER_MAPPING below.

import type { FieldKey } from '../measurements/schema';

export const TEMPLATE_W = 540;
export const TEMPLATE_H = 640;

export const FINGER_MAPPING = {
  provisional: true,
  leftUpperHole: 'middle',
  rightUpperHole: 'ring',
  viewDescription: 'Viewed from above the ball, thumb hole toward the bowler',
} as const;

/**
 * box: a value in a drawn box. half: a value inside half of a hole circle.
 * line: a value written above a dotted line. pitch: a pitch box (see dir).
 */
export type SlotStyle = 'box' | 'half' | 'line' | 'pitch';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlaySlot extends Rect {
  field: FieldKey;
  style: SlotStyle;
  /** A pitch box that only shows a value pitched this way. */
  dir?: 'forward' | 'reverse' | 'left' | 'right';
  /** A lateral pitch box that shows left as minus and right as plus. */
  signed?: boolean;
  /** Draw a frame around the slot (boxes and pitch boxes). */
  framed?: boolean;
  /** Only on the sheet with or without finger grips. */
  when?: 'grips' | 'no_grips';
}

/** A row of labelled boxes on the sheet; the chosen one is filled in. */
export interface ChoiceGroup {
  field: FieldKey;
  when?: 'grips';
  options: Array<{ value: string; label: string } & Rect>;
}

export interface SheetLabel {
  text: string;
  x: number;
  y: number;
  /** Text anchor; labels are centred on x unless set. */
  anchor?: 'start' | 'middle' | 'end';
  size?: number;
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
  /** Small captions for the top and bottom halves. */
  top: string;
  bottom: string;
  name: string;
  /** A finger hole: split into grip and hole only when the fingers have grips. */
  finger?: boolean;
}

export interface Arrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Arrowheads at the start, the end, or both. */
  heads: 'start' | 'end' | 'both';
}

export interface DottedLine {
  x1: number;
  x2: number;
  y: number;
}

const finger = (side: 'left' | 'right') => FINGER_MAPPING[side === 'left' ? 'leftUpperHole' : 'rightUpperHole'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const FINGERS = {
  left: { colX: 28, cx: 169, edgeX: 29, outX: 12, latLabel: 'Lateral' },
  right: { colX: 430, cx: 368, edgeX: 507, outX: 524, latLabel: 'Lateral' },
} as const;
const HOLE_Y = 115;
const HOLE_R = 52;
const THUMB = { cx: 268, cy: 483, r: 52 };

function fingerSlots(side: 'left' | 'right'): OverlaySlot[] {
  const g = FINGERS[side];
  const f = finger(side);
  const half = { x: g.cx - 40, w: 80, h: 26 };
  return [
    { field: `${f}_grip_size`, style: 'half', when: 'grips', ...half, y: HOLE_Y - 32 },
    { field: `${f}_hole`, style: 'half', when: 'grips', ...half, y: HOLE_Y + 6 },
    { field: `${f}_hole`, style: 'half', when: 'no_grips', x: g.cx - 44, w: 88, h: 32, y: HOLE_Y - 16 },
    { field: `${f}_fr_pitch`, style: 'pitch', dir: 'reverse', framed: true, x: g.colX, y: 27, w: 78, h: 48 },
    { field: `${f}_lateral_pitch`, style: 'pitch', signed: true, framed: true, x: g.colX, y: 91, w: 78, h: 48 },
    { field: `${f}_fr_pitch`, style: 'pitch', dir: 'forward', framed: true, x: g.colX, y: 155, w: 78, h: 48 },
    { field: `${f}_inserts`, style: 'line', x: g.cx - 52, y: 28, w: 104, h: 18 },
    { field: `${f}_cut_to_cut`, style: 'box', framed: true, x: side === 'left' ? 119 : 289, y: 262, w: 132, h: 72 },
  ] as OverlaySlot[];
}

export const OVERLAY_SLOTS: OverlaySlot[] = [
  ...fingerSlots('left'),
  ...fingerSlots('right'),
  { field: 'bridge', style: 'box', framed: true, x: 230, y: 70, w: 78, h: 40 },
  { field: 'thumb_od', style: 'half', x: THUMB.cx - 40, y: THUMB.cy - 32, w: 80, h: 26 },
  { field: 'thumb_hole', style: 'half', x: THUMB.cx - 40, y: THUMB.cy + 6, w: 80, h: 26 },
  { field: 'thumb_fr_pitch', style: 'pitch', dir: 'forward', framed: true, x: 230, y: 368, w: 78, h: 48 },
  { field: 'thumb_fr_pitch', style: 'pitch', dir: 'reverse', framed: true, x: 230, y: 550, w: 78, h: 48 },
  { field: 'thumb_lateral_pitch', style: 'pitch', dir: 'left', framed: true, x: 124, y: 458, w: 78, h: 48 },
  { field: 'thumb_lateral_pitch', style: 'pitch', dir: 'right', framed: true, x: 334, y: 458, w: 78, h: 48 },
  { field: 'thumb_insert_type', style: 'line', x: 346, y: 404, w: 142, h: 18 },
];

export const SHEET_CIRCLES: Circle[] = [
  { cx: FINGERS.left.cx, cy: HOLE_Y, r: HOLE_R, top: 'Grip', bottom: 'Hole Size', name: cap(finger('left')), finger: true },
  { cx: FINGERS.right.cx, cy: HOLE_Y, r: HOLE_R, top: 'Grip', bottom: 'Hole Size', name: cap(finger('right')), finger: true },
  { ...THUMB, top: 'Slug Size', bottom: 'Hole Size', name: 'Thumb' },
];

export const SHEET_LABELS: SheetLabel[] = [
  // Finger pitch columns: reverse above, forward below, lateral pointing outward.
  ...(['left', 'right'] as const).flatMap((side) => {
    const g = FINGERS[side];
    const mid = g.colX + 39;
    return [
      { text: 'Reverse', x: mid, y: 20 },
      { text: g.latLabel, x: mid, y: 152 },
      { text: 'Forward', x: mid, y: 216 },
      { text: 'Inserts', x: g.cx, y: 59 },
    ];
  }),
  { text: 'Bridge', x: 269, y: 122 },
  { text: 'Forward', x: 269, y: 430 },
  { text: 'Reverse', x: 269, y: 545 },
  { text: 'Left', x: 163, y: 520 },
  { text: 'Right', x: 373, y: 520 },
  { text: 'Thumb Insert Type', x: 417, y: 396 },
];

export const SHEET_ARROWS: Arrow[] = [
  // Finger pitch columns.
  { x1: FINGERS.left.edgeX, y1: 8, x2: FINGERS.left.edgeX, y2: 214, heads: 'both' },
  { x1: FINGERS.left.colX, y1: 115, x2: FINGERS.left.outX, y2: 115, heads: 'end' },
  { x1: FINGERS.right.edgeX, y1: 8, x2: FINGERS.right.edgeX, y2: 214, heads: 'both' },
  { x1: FINGERS.right.colX + 78, y1: 115, x2: FINGERS.right.outX, y2: 115, heads: 'end' },
  // Spans: each span box points up to its finger and down to the thumb.
  { x1: 172, y1: 262, x2: 154, y2: 172, heads: 'end' },
  { x1: 368, y1: 262, x2: 386, y2: 172, heads: 'end' },
  { x1: 193, y1: 334, x2: 226, y2: 440, heads: 'end' },
  { x1: 347, y1: 334, x2: 311, y2: 440, heads: 'end' },
  // Thumb pitch.
  { x1: 269, y1: 368, x2: 269, y2: 352, heads: 'end' },
  { x1: 269, y1: 598, x2: 269, y2: 616, heads: 'end' },
  { x1: 124, y1: 482, x2: 108, y2: 482, heads: 'end' },
  { x1: 412, y1: 482, x2: 428, y2: 482, heads: 'end' },
];

export const SHEET_DOTTED: DottedLine[] = [
  { x1: FINGERS.left.cx - 52, x2: FINGERS.left.cx + 52, y: 48 },
  { x1: FINGERS.right.cx - 52, x2: FINGERS.right.cx + 52, y: 48 },
  { x1: 352, x2: 482, y: 424 },
];

/** Grips or no grips above the bridge; with grips, STD or Vaccu under them. */
export const CHOICE_GROUPS: ChoiceGroup[] = [
  {
    field: 'finger_grips',
    options: [
      { value: 'no_grips', label: 'No Grips', x: 226, y: 8, w: 42, h: 22 },
      { value: 'grips', label: 'Grips', x: 271, y: 8, w: 42, h: 22 },
    ],
  },
  {
    field: 'grip_type',
    when: 'grips',
    options: [
      { value: 'std', label: 'STD', x: 226, y: 36, w: 42, h: 22 },
      { value: 'vaccu', label: 'Vaccu', x: 271, y: 36, w: 42, h: 22 },
    ],
  },
];

/** The span type picker drawn between the spans: one lettered circle per type. */
export const SPAN_PICKER = { y: 214, r: 15, gap: 44, cx: 269, labelY: 244 };

export const pctX = (v: number) => `${(v / TEMPLATE_W) * 100}%`;
export const pctY = (v: number) => `${(v / TEMPLATE_H) * 100}%`;
