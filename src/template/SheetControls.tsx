// Controls laid over the sheet in edit mode, so every value is typed or
// scrolled right on the picture. Pickers are native selects (a scroll wheel on
// phones) kept invisible over the box, which still shows the formatted value.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { WheelPicker, type WheelColumn } from '../components/WheelPicker';
import { parseMeasurement } from '../measurements/fraction';
import {
  FIELD_BY_KEY,
  PITCH_AMOUNTS,
  SPAN_FRACTIONS,
  SPAN_TYPE_LABELS,
  SPAN_TYPE_ORDER,
  SPAN_WHOLES,
  SPAN_FIELDS,
  PAP_MAX,
  THUMB_INSERT_TYPES,
  joinInches,
  splitInches,
  decimalHint,
  gripNumber,
  isInterchangeable,
  pickerOptions,
  joinSpan,
  splitSpan,
  type Draft,
  type FieldKey,
  type SpanType,
} from '../measurements/schema';
import { SPAN_PICKER, pctX, pctY, type ChoiceGroup, type OverlaySlot } from './overlayConfig';

export interface SheetEditor {
  draft: Draft;
  setField: (key: FieldKey, patch: Partial<{ text: string; dir: string }>) => void;
  onFocusField?: (key: FieldKey) => void;
  /** Names that have written specs before, offered for "Written by". */
  authors?: string[];
}

const FIRST_OF_AXIS = new Set(['forward', 'left']);

const inches = (a: string) => (a === '0' ? '0"' : `${a}"  (${decimalHint(a)})`);

/** The id of a slot's control; pitch boxes for one direction add it, e.g. field-thumb_fr_pitch-reverse. */
export const controlId = (slot: OverlaySlot) => `field-${slot.field}${slot.dir ? `-${slot.dir}` : ''}`;

function isZero(text: string) {
  const p = parseMeasurement(text);
  return p.ok && p.value.n === 0;
}

/** Keeps a saved value that isn't in a list selectable, so it is never dropped silently. */
const withLegacy = (options: string[], current: string) => (current && !options.includes(current) ? [current, ...options] : options);

export function SlotControl({ slot, editor, label }: { slot: OverlaySlot; editor: SheetEditor; label: string }) {
  const { draft, setField, onFocusField } = editor;
  const v = draft[slot.field];
  const id = controlId(slot);
  const focus = () => onFocusField?.(slot.field);
  const common = { id, 'aria-label': label, 'data-control': slot.field, onFocus: focus };

  if (slot.style === 'pitch' && slot.dir) {
    const dir = v.dir && v.dir !== 'none' ? v.dir : null;
    const owns = v.text.trim() !== '' && (dir ? dir === slot.dir : FIRST_OF_AXIS.has(slot.dir));
    const current = owns ? v.text : '';
    return (
      <select
        {...common}
        className="slot__picker"
        value={current}
        onChange={(e) => {
          const t = e.target.value;
          if (!t) {
            if (owns) setField(slot.field, { text: '', dir: '' });
          } else setField(slot.field, { text: t, dir: isZero(t) ? 'none' : slot.dir });
        }}
      >
        <option value="">–</option>
        {withLegacy(PITCH_AMOUNTS, current).map((a) => (
          <option key={a} value={a}>
            {inches(a)}
          </option>
        ))}
      </select>
    );
  }

  if (slot.style === 'pitch' && slot.signed) {
    // One box per finger: minus is left, plus is right.
    const steps = PITCH_AMOUNTS.slice(1);
    const options = [...[...steps].reverse().map((a) => `-${a}`), '0', ...steps.map((a) => `+${a}`)];
    const t = v.text.trim();
    const current = !t ? '' : isZero(t) || !v.dir || v.dir === 'none' ? t : `${v.dir === 'left' ? '-' : '+'}${t}`;
    return (
      <select
        {...common}
        className="slot__picker"
        value={current}
        onChange={(e) => {
          const s = e.target.value;
          if (!s) setField(slot.field, { text: '', dir: '' });
          else if (s.startsWith('-')) setField(slot.field, { text: s.slice(1), dir: 'left' });
          else if (s.startsWith('+')) setField(slot.field, { text: s.slice(1), dir: 'right' });
          else setField(slot.field, { text: s, dir: 'none' });
        }}
      >
        <option value="">–</option>
        {withLegacy(options, current).map((a) => (
          <option key={a} value={a}>
            {a.startsWith('-') ? `Left ${inches(a.slice(1))}` : a.startsWith('+') ? `Right ${inches(a.slice(1))}` : inches(a)}
          </option>
        ))}
      </select>
    );
  }

  if ((SPAN_FIELDS as readonly FieldKey[]).includes(slot.field)) return <SpanWheels slot={slot} editor={editor} label={label} />;

  const options = pickerOptions(slot.field, draft);
  if (options) {
    // Holes, grip sizes, bridge and slug size scroll through their fixed sizes.
    const grip = slot.field.endsWith('_grip_size');
    return (
      <select {...common} className="slot__picker" value={v.text} onChange={(e) => setField(slot.field, { text: e.target.value })}>
        <option value="">–</option>
        {withLegacy(options, v.text).map((o) => (
          <option key={o} value={o}>
            {grip && gripNumber(o) != null ? `${o}"  (${gripNumber(o)})` : `${o}"`}
          </option>
        ))}
      </select>
    );
  }

  if (FIELD_BY_KEY[slot.field].kind === 'enum_thumb_insert') {
    return (
      <select
        {...common}
        className="slot__picker"
        value={v.text}
        onChange={(e) => {
          setField(slot.field, { text: e.target.value });
          // Interchangeable inserts have no hole or slug size of their own.
          if (isInterchangeable(e.target.value)) {
            setField('thumb_hole', { text: '' });
            setField('thumb_od', { text: '' });
          }
        }}
      >
        <option value="">–</option>
        {withLegacy([...THUMB_INSERT_TYPES], v.text).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    );
  }

  // Hole sizes, ovals, inserts, bridge and O.D. are typed straight into the box.
  return (
    <input
      {...common}
      className="slot__input"
      type="text"
      autoComplete="off"
      spellCheck={false}
      placeholder="–"
      value={v.text}
      onChange={(e) => setField(slot.field, { text: e.target.value })}
    />
  );
}

/** Tap targets over the F / C / CTO circles; each shows that span type's saved spans, when editing or not. */
export function SpanTypeButtons({ current, onPick, onFocus }: { current: SpanType; onPick: (t: SpanType) => void; onFocus?: () => void }) {
  const first = SPAN_PICKER.cx - ((SPAN_TYPE_ORDER.length - 1) * SPAN_PICKER.gap) / 2;
  const r = SPAN_PICKER.r + 3;
  return (
    <>
      {SPAN_TYPE_ORDER.map((t, i) => {
        const cx = first + i * SPAN_PICKER.gap;
        return (
          <button
            key={t}
            type="button"
            className="sheet__pick"
            id={i === 0 ? 'field-span_type' : undefined}
            data-control="span_type"
            aria-label={SPAN_TYPE_LABELS[t]}
            aria-pressed={current === t}
            style={{ left: pctX(cx - r), top: pctY(SPAN_PICKER.y - r), width: pctX(2 * r), height: pctY(2 * r) }}
            onClick={() => onPick(t)}
            onFocus={onFocus}
          />
        );
      })}
    </>
  );
}

const SPAN_COLUMNS: WheelColumn[] = [
  { label: 'Inches', options: SPAN_WHOLES.map((w) => ({ value: w, label: w })) },
  { label: 'Fraction', options: SPAN_FRACTIONS.map((f) => ({ value: f, label: f })) },
];

/** A span box opens one picker with two wheels side by side: whole inches and sixteenths, like a date. */
function SpanWheels({ slot, editor, label }: { slot: OverlaySlot; editor: SheetEditor; label: string }) {
  const [open, setOpen] = useState(false);
  const v = editor.draft[slot.field];
  const split = splitSpan(v.text);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        id={controlId(slot)}
        className="slot__picker"
        aria-label={label}
        aria-haspopup="dialog"
        data-control={slot.field}
        data-value={v.text}
        onFocus={() => editor.onFocusField?.(slot.field)}
        onClick={() => setOpen(true)}
      />
      {open &&
        createPortal(
          <WheelPicker
            title={label}
            columns={SPAN_COLUMNS}
            initial={[split?.whole ?? SPAN_WHOLES[2], split?.fraction ?? '0']}
            onDone={([whole, fraction]) => {
              editor.setField(slot.field, { text: joinSpan(whole, fraction) });
              close();
            }}
            onClear={() => {
              editor.setField(slot.field, { text: '' });
              close();
            }}
            onClose={close}
          />,
          document.body,
        )}
    </>
  );
}

/** Tap targets over a row of boxes such as Grips / No Grips; tapping the chosen one again clears it. */
export function ChoiceButtons({
  group,
  value,
  editor,
  sheetH,
}: {
  group: ChoiceGroup;
  value?: string;
  editor: SheetEditor;
  /** Height of the drawn sheet, which is shorter for a no-thumb fit. */
  sheetH?: number;
}) {
  function choose(next: string) {
    editor.setField(group.field, { text: next });
    // Without grips there is no grip type or grip size, and the hole is a plain drilled size.
    if (group.field === 'finger_grips' && next !== 'grips') {
      for (const key of ['grip_type', 'middle_grip_size', 'ring_grip_size'] as const) editor.setField(key, { text: '' });
    }
  }
  return (
    <>
      {group.options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          className="sheet__pick sheet__pick--box"
          id={i === 0 ? `field-${group.field}` : undefined}
          data-control={group.field}
          aria-label={o.label}
          aria-pressed={value === o.value}
          style={{ left: pctX(o.x), top: pctY(o.y, sheetH), width: pctX(o.w), height: pctY(o.h, sheetH) }}
          onClick={() => choose(value === o.value ? '' : o.value)}
          onFocus={() => editor.onFocusField?.(group.field)}
        />
      ))}
    </>
  );
}

const wholes = (max: number) => Array.from({ length: max + 1 }, (_, i) => ({ value: String(i), label: String(i) }));
const FRACTIONS = SPAN_FRACTIONS.map((f) => ({ value: f, label: f }));
const PAP_COLUMNS: WheelColumn[] = [
  { label: 'Horizontal inches', options: wholes(PAP_MAX) },
  { label: 'Horizontal fraction', options: FRACTIONS },
  { label: 'Vertical inches', options: wholes(2) },
  { label: 'Vertical fraction', options: FRACTIONS },
];

/** The P.A.P box opens wheels for horizontal and vertical inches and fractions, with Up or Down. */
export function PapControl({ editor, text }: { editor: SheetEditor; text: string }) {
  const [open, setOpen] = useState(false);
  const h = editor.draft.pap_horizontal;
  const v = editor.draft.pap_vertical;
  const [dir, setDir] = useState(v.dir);
  const hs = splitInches(h.text);
  const vs = splitInches(v.text);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        id="field-pap"
        className="sheet-footer__button"
        aria-haspopup="dialog"
        aria-label="P.A.P"
        data-control="pap_horizontal"
        data-value={text}
        onFocus={() => editor.onFocusField?.('pap_horizontal')}
        onClick={() => {
          setDir(v.dir);
          setOpen(true);
        }}
      >
        {text || <span className="slot__empty">–</span>}
      </button>
      {open &&
        createPortal(
          <WheelPicker
            title="P.A.P"
            columns={PAP_COLUMNS}
            groups={[
              { label: 'Horizontal', span: 2 },
              { label: 'Vertical', span: 2 },
            ]}
            initial={[hs?.whole ?? '5', hs?.fraction ?? '0', vs?.whole ?? '0', vs?.fraction ?? '0']}
            footer={
              <div className="wheel-sheet__dirs" role="group" aria-label="Vertical direction">
                {(['up', 'down'] as const).map((d) => (
                  <button key={d} type="button" aria-pressed={dir === d} onClick={() => setDir(d)}>
                    {d === 'up' ? 'Up' : 'Down'}
                  </button>
                ))}
              </div>
            }
            onDone={([hw, hf, vw, vf]) => {
              const vertical = joinInches(vw, vf, 2);
              editor.setField('pap_horizontal', { text: joinInches(hw, hf, PAP_MAX) });
              editor.setField('pap_vertical', { text: vertical, dir: vertical === '0' ? 'none' : dir || '' });
              close();
            }}
            onClear={() => {
              editor.setField('pap_horizontal', { text: '' });
              editor.setField('pap_vertical', { text: '', dir: '' });
              close();
            }}
            onClose={close}
          />,
          document.body,
        )}
    </>
  );
}
