// Admin only: the AI's test readings of whole sheets, each beside its photo,
// for marking every value right or wrong. The marks are how the reader's
// instructions get checked and tuned before it reads the whole queue.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { FIELD_BY_KEY, type FieldKey } from '../measurements/schema';
import { isAdminName, listReadsForReview, saveReadReview, type ReadForReview, type ReadReview, type SheetReadField } from './api';
import { SheetPhoto } from './SheetPage';

const EXTRA_LABELS: Record<string, string> = {
  name: 'Name',
  phone: 'Phone',
  middle_span: 'Middle finger span',
  ring_span: 'Ring finger span',
};

function label(key: string): string {
  return EXTRA_LABELS[key] ?? FIELD_BY_KEY[key as FieldKey]?.label ?? key;
}

/** Every value the reading gives, name and phone first. */
function rowsOf(item: ReadForReview): SheetReadField[] {
  const r = item.read_sheet;
  return [
    { key: 'name', written: r.name ?? '', text: r.name ?? '', dir: '' },
    { key: 'phone', written: r.phone ?? '', text: r.phone ?? '', dir: '' },
    ...(r.fields ?? []),
  ];
}

function score(review: ReadReview | null): string {
  if (!review) return '';
  const marks = Object.values(review.marks);
  return `${marks.filter((m) => m.ok).length} of ${marks.length} right`;
}

function useReads() {
  return useAsync(() => listReadsForReview(), []);
}

export function AiReviewList() {
  const name = useOutletContext<string>();
  const reads = useReads();
  if (!isAdminName(name)) return <NotAdmin />;
  const list = reads.data ?? [];
  const done = list.filter((r) => r.read_review);
  const marks = done.flatMap((r) => Object.values(r.read_review!.marks));
  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/">← Queue</Link>
      </p>
      <h1>AI test reads</h1>
      <p className="muted">
        The AI read these whole sheets as a test. Mark each value right or wrong. The sheets are still in the queue as usual.
      </p>
      <ErrorBanner error={reads.error} onRetry={reads.reload} />
      {reads.loading ? (
        <Spinner />
      ) : (
        <>
          <p>
            <strong>
              {done.length} of {list.length} reviewed
            </strong>
            {marks.length > 0 && ` · ${marks.filter((m) => m.ok).length} of ${marks.length} values right so far`}
          </p>
          <ul className="intake-matches ai-review-list">
            {list.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.read_sheet.name || 'No name read'}</strong>
                  <span className="muted small">
                    {' '}
                    · {r.read_sheet.fields?.length ?? 0} values
                    {r.read_review ? ` · ${score(r.read_review)}, by ${r.read_reviewed_by ?? 'someone'}` : ''}
                    {r.read_sheet.error ? ' · could not read' : ''}
                  </span>
                </span>
                <Link className="btn btn--small" to={`/ai-review/${r.id}`}>
                  {r.read_review ? 'Look again' : 'Review'}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

export function AiReviewPage() {
  const { itemId = '' } = useParams();
  const name = useOutletContext<string>();
  const navigate = useNavigate();
  const reads = useReads();
  if (!isAdminName(name)) return <NotAdmin />;
  if (reads.loading) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }
  const list = reads.data ?? [];
  const item = list.find((r) => r.id === itemId);
  if (reads.error || !item) {
    return (
      <main className="page">
        <p className="breadcrumb">
          <Link to="/ai-review">← AI test reads</Link>
        </p>
        <ErrorBanner error={reads.error ?? 'Reading not found'} onRetry={reads.reload} />
      </main>
    );
  }
  const next = list.find((r) => r.id !== itemId && !r.read_review);
  return (
    <div className="intake-work">
      <SheetPhoto item={item} />
      <div className="intake-work__form">
        <div className="intake-work__bar">
          <Link to="/ai-review" className="breadcrumb">
            ← AI test reads
          </Link>
        </div>
        <ReviewForm
          key={item.id}
          item={item}
          by={name}
          onSaved={() => navigate(next ? `/ai-review/${next.id}` : '/ai-review')}
        />
      </div>
    </div>
  );
}

function ReviewForm({ item, by, onSaved }: { item: ReadForReview; by: string; onSaved: () => void }) {
  const read = item.read_sheet;
  const rows = rowsOf(item);
  const [marks, setMarks] = useState<ReadReview['marks']>(() => item.read_review?.marks ?? {});
  const [missed, setMissed] = useState(item.read_review?.missed ?? '');
  const [note, setNote] = useState(item.read_review?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => window.scrollTo(0, 0), []);

  const unmarked = rows.filter((r) => !marks[r.key]).length;

  function mark(key: string, ok: boolean) {
    setMarks((m) => ({ ...m, [key]: { ok, fix: ok ? undefined : m[key]?.fix ?? '' } }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveReadReview(item.id, { marks, missed: missed.trim(), note: note.trim() }, by);
      onSaved();
    } catch (e) {
      setError(toAppError(e));
      setSaving(false);
    }
  }

  return (
    <section className="ai-review">
      <h1>{read.name || 'No name read'}</h1>
      <p className="muted small">
        Read {formatDateTime(read.at)}
        {item.read_reviewed_at && ` · reviewed by ${item.read_reviewed_by ?? 'someone'} ${formatDateTime(item.read_reviewed_at)}`}
      </p>
      {read.error && <Notice tone="warn">The AI couldn't read this sheet: {read.error}</Notice>}
      {!!read.review_reasons?.length && (
        <Notice tone="warn">
          <div>
            <strong>The AI flagged:</strong>
            <ul>
              {read.review_reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </Notice>
      )}
      <ErrorBanner error={error} />
      <div className="intake-people__wrap">
        <table className="ai-review__table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">On the paper</th>
              <th scope="col">AI entered</th>
              <th scope="col">Right?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = marks[r.key];
              return (
                <tr key={r.key} data-mark={m ? (m.ok ? 'ok' : 'wrong') : undefined}>
                  <th scope="row">
                    {label(r.key)}
                    {read.unsure?.includes(r.key) && <span className="muted small"> (unsure)</span>}
                  </th>
                  <td>{r.written || <span className="muted">blank</span>}</td>
                  <td>
                    {[r.text.replace(/_/g, ' '), r.dir].filter(Boolean).join(' ') || <span className="muted">blank</span>}
                    {m && !m.ok && (
                      <input
                        className="ai-review__fix"
                        aria-label={`Right value for ${label(r.key)}`}
                        placeholder="Right value"
                        value={m.fix ?? ''}
                        onChange={(e) => setMarks((all) => ({ ...all, [r.key]: { ok: false, fix: e.target.value } }))}
                      />
                    )}
                  </td>
                  <td className="ai-review__marks">
                    <button type="button" className="btn btn--small" aria-pressed={m?.ok === true} onClick={() => mark(r.key, true)}>
                      Right
                    </button>
                    <button type="button" className="btn btn--small" aria-pressed={m?.ok === false} onClick={() => mark(r.key, false)}>
                      Wrong
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        <button
          type="button"
          className="linklike"
          onClick={() => setMarks((m) => Object.fromEntries(rows.map((r) => [r.key, m[r.key] ?? { ok: true }])))}
        >
          Mark the rest right
        </button>
      </p>
      <label>
        Anything on the sheet the AI missed
        <textarea value={missed} maxLength={4000} rows={3} placeholder="e.g. Thumb pitch 1/4 forward is on the sheet" onChange={(e) => setMissed(e.target.value)} />
      </label>
      <label>
        Note for next time <span className="muted">(optional)</span>
        <textarea value={note} maxLength={4000} rows={2} placeholder="e.g. On Storm sheets the span is written sideways" onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="form__actions">
        <button type="button" className="btn btn--primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : unmarked ? `Save (${unmarked} not marked)` : 'Save and next'}
        </button>
      </div>
    </section>
  );
}

function NotAdmin() {
  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/">← Queue</Link>
      </p>
      <Notice>Only the admin can see this page.</Notice>
    </main>
  );
}
