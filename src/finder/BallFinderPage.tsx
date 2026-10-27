import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toAppError, type AppError } from '../lib/errors';
import { formatDate, formatSheetDate } from '../lib/format';
import { ErrorBanner, Spinner } from '../components/ui';
import {
  BRIDGE_SIZES,
  GRIP_SIZES,
  GRIPS_LABELS,
  HAND_LABELS,
  HOLE_SIZES,
  PITCH_AMOUNTS,
  SLUG_SIZES,
  SPAN_TYPE_HINTS,
  SPAN_TYPE_LABELS,
  SPAN_TYPE_ORDER,
  THUMB_INSERT_TYPES,
  type SpanType,
} from '../measurements/schema';
import { DATE_KIND_LABELS, listFinderSheets, monthRange, type DateKind } from './api';
import {
  EMPTY_BALL,
  hasMeasurements,
  measurementErrors,
  rankBowlers,
  type BallMeasurements,
  type BowlerMatch,
  type FinderSheet,
  type Pitch,
} from './match';

const STORAGE_KEY = 'proshop:ballFinder';
const SHOWN_STEP = 20;

interface Filters {
  kind: DateKind;
  month: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { kind: 'any', month: '', from: '', to: '' };

/** Kept for this tab, so opening a bowler and coming back keeps what was typed. */
function loadSaved(): { ball: BallMeasurements; filters: Filters } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved) return { ball: { ...EMPTY_BALL, ...saved.ball }, filters: { ...EMPTY_FILTERS, ...saved.filters } };
  } catch {
    // Storage can be blocked or hold something old; start empty.
  }
  return { ball: EMPTY_BALL, filters: EMPTY_FILTERS };
}

export function BallFinderPage() {
  const [ball, setBall] = useState<BallMeasurements>(() => loadSaved().ball);
  const [filters, setFilters] = useState<Filters>(() => loadSaved().filters);
  const [sheets, setSheets] = useState<FinderSheet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [retry, setRetry] = useState(0);
  const [shown, setShown] = useState(SHOWN_STEP);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ball, filters }));
    } catch {
      // Not saved; the page still works.
    }
  }, [ball, filters]);

  const { kind, from, to } = filters;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      listFinderSheets(kind, from, to, controller.signal)
        .then(setSheets)
        .catch((e) => {
          if (!controller.signal.aborted) setError(toAppError(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [kind, from, to, retry]);

  const errors = measurementErrors(ball);
  const measuring = hasMeasurements(ball);
  const matches = useMemo(() => (sheets && measuring ? rankBowlers(ball, sheets) : []), [ball, sheets, measuring]);
  const datedOnly = useMemo(() => (sheets && !measuring ? newestPerBowler(sheets) : []), [sheets, measuring]);
  const dateFiltered = kind !== 'any' && (from || to);

  useEffect(() => setShown(SHOWN_STEP), [ball, filters]);

  function set<K extends keyof BallMeasurements>(key: K, value: BallMeasurements[K]) {
    setBall((b) => ({ ...b, [key]: value }));
  }

  function setMonth(month: string) {
    const range = monthRange(month);
    setFilters((f) => ({ ...f, month, from: range?.from ?? '', to: range?.to ?? '' }));
  }

  const numberInput = (key: keyof typeof errors, label: string, options: string[], example = '1 1/64') => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        autoComplete="off"
        list={`finder-${key}-list`}
        placeholder={`e.g. ${example}`}
        value={ball[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={errors[key] ? true : undefined}
      />
      <datalist id={`finder-${key}-list`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {errors[key] && <span className="field-error">{errors[key]}</span>}
    </label>
  );

  const pitchInput = (key: keyof typeof errors, label: string, dirs: [string, string]) => {
    const value = ball[key] as Pitch;
    return (
      <label className="field">
        <span className="field__label">{label}</span>
        <span className="finder__pitch">
          <input
            autoComplete="off"
            list="finder-pitch-list"
            placeholder="Amount"
            value={value.text}
            onChange={(e) => set(key, { ...value, text: e.target.value } as never)}
            aria-invalid={errors[key] ? true : undefined}
          />
          <select value={value.dir} onChange={(e) => set(key, { ...value, dir: e.target.value } as never)} aria-label={`${label} direction`}>
            <option value="">Not sure</option>
            {dirs.map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </span>
        {errors[key] && <span className="field-error">{errors[key]}</span>}
      </label>
    );
  };

  return (
    <main className="page">
      <p className="breadcrumb no-print">
        <Link to="/">← Customers</Link>
      </p>
      <div className="dashboard__head">
        <h1>Find a ball's owner</h1>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setBall(EMPTY_BALL);
            setFilters(EMPTY_FILTERS);
          }}
        >
          Clear
        </button>
      </div>
      <p className="muted">
        Measure what you can off the ball. Every saved spec sheet is compared, and the closest bowlers are listed with how well
        they match. Leave anything you didn't measure blank. To narrow it down, type a range in any box, such as{' '}
        <strong>3 7/8 to 4 5/16</strong>: only sheets inside that range are listed.
      </p>

      <div className="finder__forms">
        <fieldset className="fieldset">
          <legend>Measurements off the ball</legend>
          <div className="finder__grid">
            {numberInput('thumb_hole', 'Thumb hole', HOLE_SIZES)}
            {numberInput('middle_hole', 'Middle finger hole', HOLE_SIZES)}
            {numberInput('ring_hole', 'Ring finger hole', HOLE_SIZES)}
          </div>
          <div className="finder__grid">
            <label className="field">
              <span className="field__label">Span measured as</span>
              <select value={ball.span_type} onChange={(e) => set('span_type', e.target.value as SpanType)}>
                {SPAN_TYPE_ORDER.map((t) => (
                  <option key={t} value={t} title={SPAN_TYPE_HINTS[t]}>
                    {SPAN_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            {numberInput('middle_span', 'Middle finger span', [], '4 3/8')}
            {numberInput('ring_span', 'Ring finger span', [], '4 1/2')}
          </div>
          <div className="finder__grid">
            {numberInput('bridge', 'Bridge', BRIDGE_SIZES, '1/4')}
            <label className="field">
              <span className="field__label">Finger grips</span>
              <select value={ball.finger_grips} onChange={(e) => set('finger_grips', e.target.value)}>
                <option value="">Not sure</option>
                {Object.entries(GRIPS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Thumb insert</span>
              <select value={ball.thumb_insert_type} onChange={(e) => set('thumb_insert_type', e.target.value)}>
                <option value="">Not sure</option>
                {THUMB_INSERT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {ball.finger_grips === 'grips' && (
            <div className="finder__grid">
              {numberInput('middle_grip_size', 'Middle grip size', GRIP_SIZES.map(([s]) => s), '3/4')}
              {numberInput('ring_grip_size', 'Ring grip size', GRIP_SIZES.map(([s]) => s), '3/4')}
            </div>
          )}
          <div className="finder__grid">
            {ball.thumb_insert_type === 'Thumb Slug' && numberInput('thumb_od', 'Thumb slug size', SLUG_SIZES, '1 1/8')}
            <label className="field">
              <span className="field__label">Bowling hand (from the layout)</span>
              <select value={ball.hand} onChange={(e) => set('hand', e.target.value)}>
                <option value="">Not sure</option>
                {Object.entries(HAND_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="finder__more">
            <summary>Pitches</summary>
            <datalist id="finder-pitch-list">
              {PITCH_AMOUNTS.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            <div className="finder__grid finder__grid--wide">
              {pitchInput('thumb_lateral_pitch', 'Thumb lateral', ['left', 'right'])}
              {pitchInput('thumb_fr_pitch', 'Thumb fwd/rev', ['forward', 'reverse'])}
              {pitchInput('middle_lateral_pitch', 'Middle lateral', ['left', 'right'])}
              {pitchInput('middle_fr_pitch', 'Middle fwd/rev', ['forward', 'reverse'])}
              {pitchInput('ring_lateral_pitch', 'Ring lateral', ['left', 'right'])}
              {pitchInput('ring_fr_pitch', 'Ring fwd/rev', ['forward', 'reverse'])}
            </div>
          </details>
        </fieldset>

        <fieldset className="fieldset">
          <legend>Spec sheet date</legend>
          <div className="finder__grid">
            <label className="field">
              <span className="field__label">Filter by</span>
              <select value={kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as DateKind }))}>
                {(Object.entries(DATE_KIND_LABELS) as Array<[DateKind, string]>).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {kind !== 'any' && (
              <>
                <label className="field">
                  <span className="field__label">Month</span>
                  <input type="month" value={filters.month} onChange={(e) => setMonth(e.target.value)} />
                </label>
                <span className="finder__dates">
                  <label className="field">
                    <span className="field__label">From</span>
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFilters((f) => ({ ...f, month: '', from: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">To</span>
                    <input type="date" value={to} onChange={(e) => setFilters((f) => ({ ...f, month: '', to: e.target.value }))} />
                  </label>
                </span>
              </>
            )}
          </div>
          {kind === 'paper' && (
            <p className="muted small">
              The date written on the paper sheet, as the AI reader read it. Sheets typed in without a dated paper photo are left
              out.
            </p>
          )}
          {kind === 'entered' && <p className="muted small">The day the spec sheet version was saved in the app.</p>}
        </fieldset>
      </div>

      <ErrorBanner error={error} onRetry={() => setRetry((r) => r + 1)} />

      <section aria-labelledby="finder-results" aria-live="polite">
        <h2 id="finder-results" className="section-title">
          {measuring ? 'Closest bowlers' : dateFiltered ? 'Spec sheets in these dates' : 'Results'}
          {!loading && sheets && (measuring ? matches.length > 0 : datedOnly.length > 0) && (
            <span className="muted"> ({measuring ? matches.length : datedOnly.length})</span>
          )}
        </h2>
        {loading ? (
          <Spinner label="Loading spec sheets…" />
        ) : error || !sheets ? null : measuring ? (
          matches.length === 0 ? (
            <p className="empty">No spec sheets match these measurements{dateFiltered ? ' in these dates' : ''}.</p>
          ) : (
            <ul className="finder__results">
              {matches.slice(0, shown).map((m) => (
                <MatchRow key={m.sheet.customer_id} match={m} />
              ))}
            </ul>
          )
        ) : !dateFiltered ? (
          <p className="empty">Enter a measurement to see the closest bowlers, or pick dates to list the spec sheets from then.</p>
        ) : datedOnly.length === 0 ? (
          <p className="empty">No spec sheets in these dates.</p>
        ) : (
          <ul className="finder__results">
            {datedOnly.slice(0, shown).map((s) => (
              <li key={s.customer_id} className="finder__result">
                <div className="finder__who">
                  <Link to={`/customers/${s.customer_id}`} className="finder__name">
                    {s.name}
                  </Link>
                  {s.phone && <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a>}
                </div>
                <p className="muted small">{sheetDescription(s)}</p>
              </li>
            ))}
          </ul>
        )}
        {!loading && (measuring ? matches.length : datedOnly.length) > shown && (
          <button type="button" className="btn" onClick={() => setShown((n) => n + SHOWN_STEP)}>
            Show more
          </button>
        )}
      </section>
    </main>
  );
}

function MatchRow({ match }: { match: BowlerMatch }) {
  const { sheet } = match;
  const tone = match.percent >= 90 ? 'high' : match.percent >= 70 ? 'mid' : 'low';
  return (
    <li className="finder__result">
      <div className="finder__top">
        <span className={`finder__percent finder__percent--${tone}`} aria-label={`${match.percent} percent match`}>
          {match.percent}%
        </span>
        <div className="finder__who">
          <Link to={`/customers/${sheet.customer_id}`} className="finder__name">
            {sheet.name}
          </Link>
          {sheet.phone ? <a href={`tel:${sheet.phone.replace(/[^\d+]/g, '')}`}>{sheet.phone}</a> : <span className="muted">No phone</span>}
        </div>
      </div>
      <p className="muted small">
        Compared {match.compared} of {match.measured} measurement{match.measured === 1 ? '' : 's'}. {sheetDescription(sheet)}
        {match.versions > 1 ? ` Best of ${match.versions} versions.` : ''}
      </p>
      <details>
        <summary className="small">Ball vs. sheet</summary>
        <table className="finder__table">
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              <th scope="col">Ball</th>
              <th scope="col">Sheet</th>
              <th scope="col">Match</th>
            </tr>
          </thead>
          <tbody>
            {match.fields.map((f) => (
              <tr key={f.label}>
                <th scope="row">{f.label}</th>
                <td>{choiceLabel(f.ball)}</td>
                <td>{f.sheet == null ? <span className="muted">blank</span> : choiceLabel(f.sheet)}</td>
                <td>{f.sheet == null ? <span className="muted">?</span> : `${Math.round(f.score * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </li>
  );
}

const CHOICE_LABELS: Record<string, string> = { ...HAND_LABELS, ...GRIPS_LABELS };

function choiceLabel(value: string): string {
  return CHOICE_LABELS[value] ?? value;
}

function sheetDescription(s: FinderSheet): string {
  const which = s.is_current ? 'Current spec sheet' : `Older version (v${s.revision_number})`;
  const dated = s.sheet_date ? `, dated ${formatSheetDate(s.sheet_date)} on the paper` : '';
  return `${which}${dated}, entered ${formatDate(s.entered_at)}.`;
}

/** One row per bowler for a date-only search: their newest version in range. */
function newestPerBowler(sheets: FinderSheet[]): FinderSheet[] {
  const best = new Map<string, FinderSheet>();
  for (const s of sheets) {
    const prev = best.get(s.customer_id);
    if (!prev || (s.sheet_date ?? s.entered_at) > (prev.sheet_date ?? prev.entered_at)) best.set(s.customer_id, s);
  }
  return [...best.values()].sort((a, b) => ((b.sheet_date ?? b.entered_at) > (a.sheet_date ?? a.entered_at) ? 1 : -1));
}
