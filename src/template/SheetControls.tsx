// Controls laid over the sheet in edit mode, so every value is typed or
// scrolled right on the picture. Pickers are native selects (a scroll wheel on
// phones) kept invisible over the box, which still shows the formatted value.

import type { CSSProperties } from 'react';
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

  if (FIELD_BY_KEY[slot.field].kind === 'length' && slot.style === 'box' && slot.field.endsWith('_cut_to_cut')) {
    // Spans scroll on two wheels, like a date: whole inches on the left half, sixteenths on the right.
    const split = splitSpan(v.text);
    const legacy = v.text.trim() !== '' && !split;
    const whole = split?.whole ?? '';
    const fraction = split?.fraction ?? '0';
    const half: CSSProperties = { width: '50%' };
    return (
      <>
        <select
          {...common}
          aria-label={`${label}, whole inches`}
          className="slot__picker"
          style={{ ...half, left: 0 }}
          value={legacy ? v.text : whole}
          onChange={(e) => setField(slot.field, { text: joinSpan(e.target.value, fraction) })}
        >
          <option value="">–</option>
          {legacy && <option value={v.text}>{v.text}</option>}
          {SPAN_WHOLES.map((w) => (
            <option key={w} value={w}>
              {w}"
            </option>
          ))}
        </select>
        <select
          id={`${id}-fraction`}
          aria-label={`${label}, fraction`}
          data-control={slot.field}
          onFocus={focus}
          className="slot__picker"
          style={{ ...half, left: '50%' }}
          value={fraction}
          onChange={(e) => setField(slot.field, { text: joinSpan(whole || SPAN_WHOLES[2], e.target.value) })}
        >
          {SPAN_FRACTIONS.map((f) => (
            <option key={f} value={f}>
              {inches(f)}
            </option>
          ))}
        </select>
      </>
    );
  }

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
