import type { KeyboardEvent } from 'react';
import {
  FIELD_BY_KEY,
  FIELDS,
  GROUP_LABELS,
  directionLabel,
  formatValue,
  isNotApplicable,
  parseDisplayDraft,
  type Draft,
  type DraftErrors,
  type FieldGroup,
  type FieldKey,
  type Snapshot,
} from '../measurements/schema';
import { FINGER_MAPPING, OVERLAY_LABELS, OVERLAY_SLOTS, SPAN_HEADING, TEMPLATE_SIZE, TEMPLATE_SRC, pct, type OverlaySlot } from './overlayConfig';

export type SlotDisplay =
  | { state: 'value'; text: string; dir?: string }
  | { state: 'empty' }
  | { state: 'na' }
  | { state: 'invalid'; text: string };

export type DisplayFn = (key: FieldKey) => SlotDisplay;

export function displayFromSnapshot(snapshot: Snapshot | null): DisplayFn {
  return (key) => {
    if (isNotApplicable(key, snapshot)) return { state: 'na' };
    const v = snapshot?.[key] ?? null;
    if (v == null) return { state: 'empty' };
    if (typeof v === 'string') return { state: 'value', text: formatValue(key, v) ?? v };
    return { state: 'value', text: v.entered, dir: 'dir' in v ? String(v.dir) : undefined };
  };
}

export function displayFromDraft(draft: Draft, errors: DraftErrors): DisplayFn {
  const thumbMode = draft.thumb_mode.text;
  return (key) => {
    if (FIELD_BY_KEY[key].thumbDependent && thumbMode === 'no_thumb') return { state: 'na' };
    const parsed = parseDisplayDraft(draft, key);
    if (parsed == null) return { state: 'empty' };
    if (errors[key]) return { state: 'invalid', text: parsed.text || '?' };
    return { state: 'value', ...parsed };
  };
}

const ARROWS: Record<string, string> = { left: '←', right: '→', forward: '↑', reverse: '↓' };

/** Font size (in template pixels) that keeps text inside its box, wrapping to two lines if needed. */
export function fitFont(text: string, w: number, h: number, max = 15): { size: number; lines: 1 | 2 } {
  const len = Math.max(text.length, 1);
  const charW = 0.6;
  const oneLine = Math.min(max, (w - 8) / (len * charW), (h - 4) / 1.2);
  if (oneLine >= 10) return { size: oneLine, lines: 1 };
  const twoLines = Math.min(max, ((w - 8) * 2) / (len * charW), (h - 4) / 2.4);
  return { size: Math.max(Math.min(twoLines, max), 5), lines: 2 };
}

function slotText(slot: OverlaySlot, d: SlotDisplay): string {
  if (d.state === 'na') return 'N/A';
  if (d.state === 'empty') return '';
  const unit = slot.style === 'angle' ? '°' : '';
  const dir = d.state === 'value' && d.dir ? ` ${ARROWS[d.dir] ?? ''}${directionLabel(d.dir)}` : '';
  return `${slot.prefix ? slot.prefix + ' ' : ''}${d.text}${unit}${dir}`;
}

interface SpecSheetProps {
  display: DisplayFn;
  /** In edit mode, clicking a field on the sheet calls this to focus its form control. */
  onSelectField?: (key: FieldKey) => void;
  activeField?: FieldKey | null;
  caption?: string;
}

export function SpecSheet({ display, onSelectField, activeField, caption }: SpecSheetProps) {
  const interactive = !!onSelectField;
  return (
    <figure className="sheet-figure">
      <div
        className={`sheet${interactive ? ' sheet--interactive' : ''}`}
        role="img"
        aria-label={caption ?? 'Fitting spec sheet. The full list of values is available as text below.'}
      >
        <img src={TEMPLATE_SRC} alt="" width={TEMPLATE_SIZE} height={TEMPLATE_SIZE} className="sheet__template" draggable={false} />
        {OVERLAY_LABELS.map((l) => (
          <span
            key={l.text}
            className="sheet__label"
            aria-hidden="true"
            style={{ left: pct(l.x), top: pct(l.y), width: pct(l.w), height: pct(l.h) }}
          >
            {l.text}
          </span>
        ))}
        <SpanHeading display={display} />
        {OVERLAY_SLOTS.map((slot) => {
          const d = display(slot.field);
          const text = slotText(slot, d);
          const { size, lines } = fitFont(text, slot.w, slot.h, slot.style === 'hole' ? 17 : 15);
          const cls = [
            'slot',
            `slot--${slot.style}`,
            `slot--${d.state}`,
            lines === 2 ? 'slot--wrap' : '',
            activeField === slot.field ? 'slot--active' : '',
          ].join(' ');
          const style = {
            left: pct(slot.x),
            top: pct(slot.y),
            width: pct(slot.w),
            height: pct(slot.h),
            fontSize: `${(size / TEMPLATE_SIZE) * 100}cqw`,
          };
          const label = FIELD_BY_KEY[slot.field].label;
          const content =
            d.state === 'empty' ? (
              <span className="slot__empty">–</span>
            ) : slot.prefix && d.state !== 'na' ? (
              <>
                <span className="slot__prefix">{slot.prefix}</span> {text.slice(slot.prefix.length + 1)}
              </>
            ) : (
              text
            );
          if (interactive) {
            return (
              <button
                type="button"
                key={slot.field}
                className={cls}
                style={style}
                data-field={slot.field}
                title={`Edit ${label}`}
                aria-label={`Edit ${label}`}
                onClick={() => onSelectField?.(slot.field)}
                onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && onSelectField?.(slot.field)}
              >
                {content}
              </button>
            );
          }
          return (
            <span key={slot.field} className={cls} style={style} data-field={slot.field} title={label} aria-hidden="true">
              {content}
            </span>
          );
        })}
      </div>
      <figcaption className="sheet-legend">
        <strong>Orientation{FINGER_MAPPING.provisional ? ' (provisional)' : ''}:</strong> {FINGER_MAPPING.viewDescription}. Left
        upper hole = {FINGER_MAPPING.leftUpperHole}, right upper hole = {FINGER_MAPPING.rightUpperHole}. The layout is the same for
        left- and right-handed bowlers. Units: inches; oval angle in degrees. Pitch shows Lat (lateral: left/right) and F/R
        (forward/reverse). “–” means not recorded; N/A means not applicable in no-thumb mode.
      </figcaption>
    </figure>
  );
}

function SpanHeading({ display }: { display: DisplayFn }) {
  const d = display('span_type');
  const text = d.state === 'value' ? d.text : 'Span';
  return (
    <span
      className="sheet__label sheet__label--span"
      data-span-heading
      aria-hidden="true"
      style={{ left: pct(SPAN_HEADING.x), top: pct(SPAN_HEADING.y), width: pct(SPAN_HEADING.w), height: pct(SPAN_HEADING.h) }}
    >
      {text}
    </span>
  );
}

const GROUP_ORDER: FieldGroup[] = ['identity', 'middle', 'ring', 'spans', 'thumb', 'details'];

/** Accessible, printable text version of the complete sheet. */
export function SheetTable({ snapshot }: { snapshot: Snapshot | null }) {
  return (
    <div className="sheet-table">
      {GROUP_ORDER.map((group) => (
        <table key={group}>
          <caption>
            {GROUP_LABELS[group]}
            {(group === 'thumb' || group === 'spans') && snapshot?.thumb_mode === 'no_thumb' ? ' (not applicable: no-thumb)' : ''}
          </caption>
          <tbody>
            {FIELDS.filter((f) => f.group === group).map((f) => {
              const v = formatValue(f.key, snapshot?.[f.key] ?? null, { unit: true });
              const na = isNotApplicable(f.key, snapshot);
              return (
                <tr key={f.key}>
                  <th scope="row">{f.label}</th>
                  <td className={v == null ? 'muted' : undefined}>
                    {v == null ? 'Not recorded' : v}
                    {na && v != null ? ' (saved, not applicable in no-thumb mode)' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </div>
  );
}
