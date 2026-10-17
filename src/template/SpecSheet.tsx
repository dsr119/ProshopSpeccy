import { parseMeasurement } from '../measurements/fraction';
import {
  FIELD_BY_KEY,
  FIELDS,
  GRIPS_LABELS,
  GROUP_LABELS,
  SPAN_FIELDS,
  SPAN_TYPE_LABELS,
  SPAN_TYPE_LETTERS,
  SPAN_TYPE_ORDER,
  directionLabel,
  formatValue,
  isInterchangeable,
  isNotApplicable,
  parseDisplayDraft,
  spanField,
  type Draft,
  type DraftErrors,
  type FieldGroup,
  type FieldKey,
  type Snapshot,
  type SpanType,
} from '../measurements/schema';
import {
  CHOICE_GROUPS,
  OVERLAY_SLOTS,
  SHEET_ARROWS,
  SHEET_CIRCLES,
  SHEET_DOTTED,
  SHEET_LABELS,
  SPAN_PICKER,
  TEMPLATE_H,
  TEMPLATE_W,
  pctX,
  pctY,
  type ChoiceGroup,
  type OverlaySlot,
} from './overlayConfig';
import { ChoiceButtons, SlotControl, SpanTypeButtons, type SheetEditor } from './SheetControls';

/** Boxes typed into directly in edit mode (the inserts); everything else is a scroll picker. */
function isTyped(slot: OverlaySlot) {
  return FIELD_BY_KEY[slot.field].kind === 'text_short';
}

/** The span type the sheet shows; cut to cut until another is chosen. */
function shownSpanType(display: DisplayFn): SpanType {
  const d = display('span_type');
  const t =
    d.state === 'value' ? (Object.entries(SPAN_TYPE_LABELS).find(([, label]) => label === d.text)?.[0] as SpanType | undefined) : undefined;
  return t ?? 'cut_to_cut';
}

/** Which choice is shown as picked in a row of boxes, from its display text. */
function chosenValue(group: ChoiceGroup, display: DisplayFn): string | undefined {
  const d = display(group.field);
  return d.state === 'value' || d.state === 'invalid' ? group.options.find((o) => o.label === d.text)?.value : undefined;
}

/** The slots drawn for the current fit: grip boxes only with grips, and the span boxes for the span type shown. */
function sheetSlots(display: DisplayFn): OverlaySlot[] {
  const grips = display('finger_grips');
  const hasGrips = grips.state === 'value' && grips.text === GRIPS_LABELS.grips;
  const spanType = shownSpanType(display);
  return OVERLAY_SLOTS.filter((s) => !s.when || (s.when === 'grips') === hasGrips).map((s) =>
    (SPAN_FIELDS as readonly FieldKey[]).includes(s.field)
      ? { ...s, field: spanField(s.field.startsWith('middle') ? 'middle' : 'ring', spanType) }
      : s,
  );
}

export type SlotDisplay =
  | { state: 'value'; text: string; dir?: string }
  | { state: 'empty' }
  | { state: 'na' }
  | { state: 'invalid'; text: string; dir?: string }
  /** A pitch box for the other direction of a pitch that is recorded. */
  | { state: 'blank' };

export type DisplayFn = (key: FieldKey) => SlotDisplay;

export function displayFromSnapshot(snapshot: Snapshot | null): DisplayFn {
  return (key) => {
    if (isNotApplicable(key, snapshot)) return { state: 'na' };
    const v = snapshot?.[key] ?? null;
    if (v == null) return { state: 'empty' };
    if (typeof v === 'string') return { state: 'value', text: formatValue(key, v) ?? v };
    const text = key.endsWith('_grip_size') ? (formatValue(key, v) ?? v.entered) : v.entered;
    return { state: 'value', text, dir: 'dir' in v ? String(v.dir) : undefined };
  };
}

export function displayFromDraft(draft: Draft, errors: DraftErrors): DisplayFn {
  const thumbMode = draft.thumb_mode.text;
  return (key) => {
    if (FIELD_BY_KEY[key].thumbDependent && thumbMode === 'no_thumb') return { state: 'na' };
    if ((key === 'thumb_hole' || key === 'thumb_od') && isInterchangeable(draft.thumb_insert_type.text.trim())) return { state: 'na' };
    const parsed = parseDisplayDraft(draft, key);
    if (parsed == null) return { state: 'empty' };
    if (errors[key]) return { state: 'invalid', text: parsed.text || '?', dir: parsed.dir };
    return { state: 'value', ...parsed };
  };
}

/** Font size (in sheet units) that keeps text inside its box, wrapping to two lines if needed. */
export function fitFont(text: string, w: number, h: number, max = 15): { size: number; lines: 1 | 2 } {
  const len = Math.max(text.length, 1);
  const charW = 0.6;
  const oneLine = Math.min(max, (w - 8) / (len * charW), (h - 4) / 1.2);
  if (oneLine >= 10) return { size: oneLine, lines: 1 };
  const twoLines = Math.min(max, ((w - 8) * 2) / (len * charW), (h - 4) / 2.4);
  return { size: Math.max(Math.min(twoLines, max), 5), lines: 2 };
}

const FIRST_OF_AXIS = new Set(['forward', 'left']);

/** A pitch value shows only in the box for its direction; a neutral zero shows forward/left. */
function forSlot(slot: OverlaySlot, d: SlotDisplay): SlotDisplay {
  if (!slot.dir || (d.state !== 'value' && d.state !== 'invalid')) return d;
  const dir = d.dir && d.dir !== 'none' ? d.dir : null;
  const mine = dir ? dir === slot.dir : FIRST_OF_AXIS.has(slot.dir);
  return mine ? d : { state: 'blank' };
}

/** Pitches print as entered fractions; lateral finger pitch is signed (left -, right +). */
export function pitchText(entered: string, dir: string | undefined, signed: boolean): string {
  const parsed = parseMeasurement(entered);
  if (!signed || !parsed.ok || parsed.value.n === 0) return entered;
  return `${dir === 'left' ? '-' : dir === 'right' ? '+' : ''}${entered}`;
}

function slotText(slot: OverlaySlot, d: SlotDisplay): string {
  if (d.state === 'na') return 'N/A';
  if (d.state === 'empty' || d.state === 'blank') return '';
  if (slot.style === 'pitch' && d.state === 'value') return pitchText(d.text, d.dir, !!slot.signed);
  return d.text;
}

interface SpecSheetProps {
  display: DisplayFn;
  /** Edit mode: every box becomes a control on the picture. */
  editor?: SheetEditor;
  activeField?: FieldKey | null;
  caption?: string;
}

export function SpecSheet({ display, editor, activeField, caption }: SpecSheetProps) {
  const spanType = shownSpanType(display);
  const slots = sheetSlots(display);
  const hasGrips = slots.some((s) => s.when === 'grips');
  const choices = CHOICE_GROUPS.filter((g) => !g.when || hasGrips).map((g) => ({ group: g, value: chosenValue(g, display) }));
  return (
    <figure className="sheet-figure">
      <div
        className={`sheet${editor ? ' sheet--interactive' : ''}`}
        role={editor ? 'group' : 'img'}
        aria-label={caption ?? 'Fitting spec sheet. The full list of values is available as text below.'}
      >
        <SheetArtwork spanType={spanType} grips={hasGrips} choices={choices} />
        {slots.map((slot) => {
          const d = forSlot(slot, display(slot.field));
          const text = slotText(slot, d);
          const { size, lines } = fitFont(text, slot.w, slot.h, slot.style === 'pitch' || slot.style === 'box' ? 20 : 14);
          const typed = !!editor && d.state !== 'na' && isTyped(slot);
          const cls = [
            'slot',
            `slot--${slot.style}`,
            `slot--${d.state}`,
            lines === 2 && !typed ? 'slot--wrap' : '',
            activeField === slot.field ? 'slot--active' : '',
          ].join(' ');
          const style = {
            left: pctX(slot.x),
            top: pctY(slot.y),
            width: pctX(slot.w),
            height: pctY(slot.h),
            fontSize: `${((typed ? Math.min(slot.h * 0.6, 16) : size) / TEMPLATE_W) * 100}cqw`,
          };
          const where = slot.dir ? ` (${directionLabel(slot.dir).toLowerCase()})` : '';
          const label = FIELD_BY_KEY[slot.field].label + where;
          const key = `${slot.field}:${slot.dir ?? ''}:${slot.when ?? ''}`;
          const content = d.state === 'empty' && slot.style !== 'line' ? <span className="slot__empty">–</span> : text;
          if (editor && d.state !== 'na') {
            return (
              <div key={key} className={cls} style={style} data-field={slot.field} data-dir={slot.dir} title={label}>
                {!typed && <span aria-hidden="true">{content}</span>}
                <SlotControl slot={slot} editor={editor} label={label} />
              </div>
            );
          }
          return (
            <span key={key} className={cls} style={style} data-field={slot.field} data-dir={slot.dir} title={label} aria-hidden="true">
              {content}
            </span>
          );
        })}
        {editor && display('span_type').state !== 'na' && <SpanTypeButtons editor={editor} current={spanType} />}
        {editor && choices.map(({ group, value }) => <ChoiceButtons key={group.field} group={group} value={value} editor={editor} />)}
      </div>
      <SheetFooter display={display} editor={editor} activeField={activeField} />
    </figure>
  );
}

/** Ball motion and who wrote the specs, along the bottom of the sheet. */
export const FOOTER_FIELDS: FieldKey[] = ['rev_rate', 'axis_rotation', 'axis_tilt', 'speed', 'pap', 'written_by'];

function SheetFooter({ display, editor, activeField }: { display: DisplayFn; editor?: SheetEditor; activeField?: FieldKey | null }) {
  return (
    <dl className="sheet-footer">
      {FOOTER_FIELDS.map((key) => {
        const f = FIELD_BY_KEY[key];
        const d = display(key);
        const unit = f.unit && f.unit !== 'in' ? f.unit : null;
        const cls = ['sheet-footer__cell', `slot--${d.state}`, activeField === key ? 'slot--active' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <div key={key} className={cls} data-field={key}>
            <dt>
              <label htmlFor={editor ? `field-${key}` : undefined}>{f.shortLabel}</label>
              {unit && <span className="muted"> ({unit})</span>}
            </dt>
            <dd>
              {editor ? (
                <input
                  id={`field-${key}`}
                  data-control={key}
                  className="sheet-footer__input"
                  type="text"
                  inputMode={f.kind === 'stat' ? 'decimal' : 'text'}
                  autoComplete="off"
                  list={key === 'written_by' && editor.authors?.length ? 'spec-authors' : undefined}
                  placeholder={key === 'written_by' ? 'Choose or type a name' : '–'}
                  value={editor.draft[key].text}
                  aria-invalid={d.state === 'invalid'}
                  onChange={(e) => editor.setField(key, { text: e.target.value })}
                  onFocus={() => editor.onFocusField?.(key)}
                />
              ) : d.state === 'value' ? (
                d.text
              ) : (
                <span className="slot__empty">–</span>
              )}
            </dd>
          </div>
        );
      })}
      {editor?.authors && (
        <datalist id="spec-authors">
          {editor.authors.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      )}
    </dl>
  );
}

const ARROW_HEAD = 7;

function head(x1: number, y1: number, x2: number, y2: number) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (da: number) => `${x2 - ARROW_HEAD * Math.cos(a + da)},${y2 - ARROW_HEAD * Math.sin(a + da)}`;
  return `${x2},${y2} ${p(0.42)} ${p(-0.42)}`;
}

/** The drawn sheet: hole circles, pitch arrows, span arrows, dotted lines, captions and the span type picker. */
function SheetArtwork({
  spanType,
  grips,
  choices,
}: {
  spanType: SpanType;
  grips: boolean;
  choices: Array<{ group: ChoiceGroup; value?: string }>;
}) {
  const types = SPAN_TYPE_ORDER;
  const first = SPAN_PICKER.cx - ((types.length - 1) * SPAN_PICKER.gap) / 2;
  return (
    <svg className="sheet__art" viewBox={`0 0 ${TEMPLATE_W} ${TEMPLATE_H}`} aria-hidden="true">
      <g className="sheet__ink">
        {SHEET_CIRCLES.map((c) => (
          <g key={c.name}>
            <circle cx={c.cx} cy={c.cy} r={c.r} fill="none" />
            {(!c.finger || grips) && <line x1={c.cx - c.r} x2={c.cx + c.r} y1={c.cy} y2={c.cy} />}
          </g>
        ))}
        {SHEET_ARROWS.map((a, i) => (
          <g key={i}>
            <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} />
            {(a.heads === 'end' || a.heads === 'both') && <polygon points={head(a.x1, a.y1, a.x2, a.y2)} />}
            {(a.heads === 'start' || a.heads === 'both') && <polygon points={head(a.x2, a.y2, a.x1, a.y1)} />}
          </g>
        ))}
        {OVERLAY_SLOTS.filter((s) => s.framed).map((s) => (
          <rect key={`${s.field}:${s.dir ?? ''}`} x={s.x} y={s.y} width={s.w} height={s.h} rx={2} fill="#fff" />
        ))}
      </g>
      <g className="sheet__dots">
        {SHEET_DOTTED.map((l, i) => (
          <line key={i} x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} />
        ))}
      </g>
      <g className="sheet__captions">
        {SHEET_CIRCLES.map((c) => (
          <g key={c.name}>
            <text x={c.cx} y={c.cy - c.r + 13} className="sheet__name">
              {c.name.toUpperCase()}
            </text>
            {(!c.finger || grips) && (
              <text x={c.cx} y={c.cy - 4} className="sheet__small">
                {c.top}
              </text>
            )}
            <text x={c.cx} y={c.cy + c.r - 6} className="sheet__small">
              {c.bottom}
            </text>
          </g>
        ))}
        {choices.flatMap(({ group, value }) =>
          group.options.map((o) => (
            <g key={`${group.field}:${o.value}`} className={`sheet__choice${o.value === value ? ' is-on' : ''}`} data-choice={o.value}>
              <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={3} />
              <text x={o.x + o.w / 2} y={o.y + o.h / 2 + 3.5}>
                {o.label}
              </text>
            </g>
          )),
        )}
        {SHEET_LABELS.map((l, i) => (
          <text key={i} x={l.x} y={l.y} textAnchor={l.anchor ?? 'middle'}>
            {l.text}
          </text>
        ))}
      </g>
      <g className="sheet__picker">
        {types.map((t, i) => {
          const on = t === spanType;
          const cx = first + i * SPAN_PICKER.gap;
          return (
            <g key={t} className={on ? 'is-on' : undefined} data-span-type={t}>
              <circle cx={cx} cy={SPAN_PICKER.y} r={SPAN_PICKER.r} />
              <text x={cx} y={SPAN_PICKER.y + 4.5} style={SPAN_TYPE_LETTERS[t].length > 2 ? { fontSize: 9.5 } : undefined}>
                {SPAN_TYPE_LETTERS[t]}
              </text>
            </g>
          );
        })}
        <text x={SPAN_PICKER.cx} y={SPAN_PICKER.labelY} className="sheet__picked" data-span-heading>
          {SPAN_TYPE_LABELS[spanType]}
        </text>
      </g>
    </svg>
  );
}

const GROUP_ORDER: FieldGroup[] = ['identity', 'fingers', 'middle', 'ring', 'spans', 'thumb', 'motion', 'details'];

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
