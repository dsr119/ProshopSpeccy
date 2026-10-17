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
  THUMB_INSERT_TYPES,
  decimalHint,
  joinSpan,
  splitSpan,
  type Draft,
  type FieldKey,
  type SpanType,
} from '../measurements/schema';
import { SPAN_PICKER, pctX, pctY, type OverlaySlot } from './overlayConfig';

export interface SheetEditor {
  draft: Draft;
  setField: (key: FieldKey, patch: Partial<{ text: string; dir: string }>) => void;
  onFocusField?: (key: FieldKey) => void;
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

  if (slot.field.endsWith('_cut_to_cut')) return <SpanWheels slot={slot} editor={editor} label={label} />;

  if (FIELD_BY_KEY[slot.field].kind === 'enum_thumb_insert') {
    return (
      <select {...common} className="slot__picker" value={v.text} onChange={(e) => setField(slot.field, { text: e.target.value })}>
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

/** Tap targets over the F / C / CTO circles; tapping the chosen one again clears it. */
export function SpanTypeButtons({ editor }: { editor: SheetEditor }) {
  const current = editor.draft.span_type.text as SpanType | '';
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
            onClick={() => editor.setField('span_type', { text: current === t ? '' : t })}
            onFocus={() => editor.onFocusField?.('span_type')}
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
