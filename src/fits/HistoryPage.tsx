import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime, formatSheetDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Dialog, ErrorBanner, Spinner } from '../components/ui';
import { FIELD_BY_KEY, diffSnapshots, type Snapshot } from '../measurements/schema';
import { SheetTable, SpecSheet, displayFromSnapshot } from '../template/SpecSheet';
import { getCustomer } from '../customers/api';
import { canImportSpecs, currentSheetPhoto, linkedRevisionId, listPhotos, setCurrentPhoto, sheetDateOf, type SpecPhoto } from '../photos/api';
import { FitIdentity, FitNotes } from '../customers/CustomerPage';
import { getCurrentFit, getRevision, listRevisions, restoreRevision, setCurrentRevision, type FitRevision } from './api';

export function ChangeTable({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
}: {
  before: Snapshot | null;
  after: Snapshot | null;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const changes = diffSnapshots(before, after);
  if (changes.length === 0) return <p className="muted">No differences.</p>;
  return (
    <table className="changes">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">{beforeLabel}</th>
          <th scope="col">{afterLabel}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.key}>
            <th scope="row">{FIELD_BY_KEY[c.key].label}</th>
            <td className={c.before == null ? 'muted' : 'prewrap'}>{c.before ?? 'Not recorded'}</td>
            <td className={c.after == null ? 'muted' : 'prewrap'}>{c.after ?? 'Not recorded'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function revisionTitle(r: FitRevision) {
  return `Revision #${r.revision_number} from ${formatDateTime(r.created_at)} by ${r.author_name ?? 'unknown'}`;
}

function RestoreDialog({
  revision,
  expectedLock,
  onClose,
  onRestored,
}: {
  revision: FitRevision;
  expectedLock: number;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await restoreRevision(revision.id, expectedLock, '');
      onRestored();
    } catch (e) {
      const err = toAppError(e);
      setError(
        err.kind === 'conflict'
          ? Object.assign(err, { message: 'Someone saved a newer version while you were looking. Reload the history and try again.' })
          : err,
      );
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Restore revision #${revision.revision_number}?`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn--primary" onClick={restore} disabled={busy}>
            {busy ? 'Restoring…' : `Restore revision #${revision.revision_number}`}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </>
      }
    >
      <p>
        This copies <strong>{revisionTitle(revision)}</strong> into a new current revision. All later revisions stay in the history.
      </p>
      <ErrorBanner error={error} />
    </Dialog>
  );
}

/** The paper sheet this version was typed in from, when there is one and it isn't already the current paper sheet. */
function paperToSwitch(revision: FitRevision, photos: SpecPhoto[], currentPhotoId: string | null): SpecPhoto | null {
  const paper = photos.find((p) => canImportSpecs(p) && linkedRevisionId(p) === revision.id) ?? null;
  return paper && paper.id !== currentSheetPhoto(photos, currentPhotoId)?.id ? paper : null;
}

/** Switches the current digital sheet to this version, and its paper sheet along with it if wanted. */
function MakeCurrentDialog({
  revision,
  expectedLock,
  paper,
  onClose,
  onDone,
}: {
  revision: FitRevision;
  expectedLock: number;
  paper: SpecPhoto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [alsoPaper, setAlsoPaper] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await setCurrentRevision(revision.id, expectedLock);
      if (paper && alsoPaper) await setCurrentPhoto(paper.id);
      onDone();
    } catch (e) {
      const err = toAppError(e);
      setError(
        err.kind === 'conflict'
          ? Object.assign(err, { message: 'Someone saved a newer version while you were looking. Reload the history and try again.' })
          : err,
      );
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Make revision #${revision.revision_number} current?`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn--primary" onClick={apply} disabled={busy}>
            {busy ? 'Saving…' : 'Make it current'}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </>
      }
    >
      <p>
        <strong>{revisionTitle(revision)}</strong> becomes the digital spec sheet shown for this bowler. Nothing is copied or deleted;
        you can switch back any time.
      </p>
      {paper && (
        <label className="checkbox">
          <input type="checkbox" checked={alsoPaper} onChange={(e) => setAlsoPaper(e.target.checked)} />
          Also make its paper sheet{paper.caption ? ` (“${paper.caption}”)` : ''} the current one
        </label>
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}

export function HistoryPage() {
  const { customerId = '' } = useParams();
  const navigate = useNavigate();
  const customer = useAsync(() => getCustomer(customerId), [customerId]);
  const data = useAsync(async () => {
    const current = await getCurrentFit(customerId);
    const [revisions, photos] = await Promise.all([current.fit ? listRevisions(current.fit.id) : [], listPhotos(customerId)]);
    return { current, revisions, photos };
  }, [customerId]);
  const [restoring, setRestoring] = useState<FitRevision | null>(null);
  const [switching, setSwitching] = useState<FitRevision | null>(null);

  const revisions = data.data?.revisions ?? [];
  const currentId = data.data?.current.fit?.current_revision_id;

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to={`/customers/${customerId}`}>← {customer.data?.name ?? 'Customer'}</Link>
      </p>
      <h1>Spec history</h1>
      <ErrorBanner error={data.error} onRetry={data.reload} />
      {data.loading ? (
        <Spinner />
      ) : revisions.length === 0 ? (
        <p className="empty">No saved revisions yet.</p>
      ) : (
        <ol className="history">
          {revisions.map((r, i) => {
            const previous = revisions[i + 1] ?? null;
            const restoredFrom = r.restored_from_revision_id ? revisions.find((x) => x.id === r.restored_from_revision_id) : null;
            return (
              <li key={r.id} className="history__item">
                <div className="history__head">
                  <h2>
                    Revision #{r.revision_number}
                    {r.id === currentId && <span className="tag">Current</span>}
                  </h2>
                  <span className="muted">
                    {formatDateTime(r.created_at)} · {r.author_name ?? 'unknown'}
                  </span>
                </div>
                {sheetDateOf(data.data?.photos ?? [], r.id) && (
                  <p>Paper sheet dated {formatSheetDate(sheetDateOf(data.data?.photos ?? [], r.id))}</p>
                )}
                {r.change_note && <p className="history__note">“{r.change_note}”</p>}
                {restoredFrom && <p className="muted small">Restored from revision #{restoredFrom.revision_number}.</p>}
                <details>
                  <summary>
                    {previous ? `${diffSnapshots(previous.snapshot, r.snapshot).length} field(s) changed from #${previous.revision_number}` : 'First revision'}
                  </summary>
                  <ChangeTable
                    before={previous?.snapshot ?? null}
                    after={r.snapshot}
                    beforeLabel={previous ? `#${previous.revision_number}` : 'Before'}
                    afterLabel={`#${r.revision_number}`}
                  />
                </details>
                <div className="form__actions">
                  <Link className="btn btn--small" to={`/customers/${customerId}/history/${r.id}`}>
                    View full sheet
                  </Link>
                  {r.id !== currentId && (
                    <>
                      <button type="button" className="btn btn--small btn--primary" onClick={() => setSwitching(r)}>
                        Make current…
                      </button>
                      <button type="button" className="btn btn--small" onClick={() => setRestoring(r)}>
                        Restore…
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {restoring && data.data?.current.fit && (
        <RestoreDialog
          revision={restoring}
          expectedLock={data.data.current.fit.lock_version}
          onClose={() => setRestoring(null)}
          onRestored={() => navigate(`/customers/${customerId}`)}
        />
      )}
      {switching && data.data?.current.fit && (
        <MakeCurrentDialog
          revision={switching}
          expectedLock={data.data.current.fit.lock_version}
          paper={paperToSwitch(switching, data.data.photos, customer.data?.current_photo_id ?? null)}
          onClose={() => setSwitching(null)}
          onDone={() => navigate(`/customers/${customerId}`)}
        />
      )}
    </main>
  );
}

export function RevisionPage() {
  const { customerId = '', revisionId = '' } = useParams();
  const navigate = useNavigate();
  const rev = useAsync(() => getRevision(revisionId), [revisionId]);
  const current = useAsync(() => getCurrentFit(customerId), [customerId]);
  const paper = useAsync(async () => {
    const [c, photos] = await Promise.all([getCustomer(customerId), listPhotos(customerId)]);
    return { currentPhotoId: c.current_photo_id, photos };
  }, [customerId]);
  const [restoring, setRestoring] = useState(false);
  const [switching, setSwitching] = useState(false);
  const r = rev.data;
  const isCurrent = current.data?.fit?.current_revision_id === revisionId;

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to={`/customers/${customerId}/history`}>← History</Link>
      </p>
      <ErrorBanner error={rev.error} onRetry={rev.reload} />
      {rev.loading || !r ? (
        rev.error ? null : <Spinner />
      ) : (
        <>
          <h1>
            Revision #{r.revision_number} {isCurrent ? (
              <span className="tag">Current</span>
            ) : r.author_name === 'AI reader' && r.revision_number > (current.data?.revision?.revision_number ?? 0) ? (
              <span className="tag tag--old">Not checked yet</span>
            ) : (
              <span className="tag tag--old">Not current</span>
            )}
          </h1>
          <p className="muted">
            Saved {formatDateTime(r.created_at)} by {r.author_name ?? 'unknown'}
            {r.change_note ? ` · “${r.change_note}”` : ''}
          </p>
          {sheetDateOf(paper.data?.photos ?? [], r.id) && <p>Paper sheet dated {formatSheetDate(sheetDateOf(paper.data?.photos ?? [], r.id))}</p>}
          <FitIdentity snapshot={r.snapshot} />
          {!isCurrent && current.data?.revision && (
            <details className="text-view" open>
              <summary>Differences from the current sheet (#{current.data.revision.revision_number})</summary>
              <ChangeTable
                before={current.data.revision.snapshot}
                after={r.snapshot}
                beforeLabel={`Current #${current.data.revision.revision_number}`}
                afterLabel={`#${r.revision_number}`}
              />
              <p className="muted small">
                <Link to={`/customers/${customerId}?view=photos`}>Open the paper photos</Link> to check which one is right.
              </p>
            </details>
          )}
          {!isCurrent && current.data?.fit && (
            <div className="form__actions">
              <button type="button" className="btn btn--primary" onClick={() => setSwitching(true)}>
                Make this the current version…
              </button>
              <button type="button" className="btn" onClick={() => setRestoring(true)}>
                Restore this revision…
              </button>
            </div>
          )}
          <div className="compare">
            <section className="compare__sheet">
              <SpecSheet display={displayFromSnapshot(r.snapshot)} caption={`Spec sheet, revision ${r.revision_number}`} />
              <FitNotes snapshot={r.snapshot} />
            </section>
          </div>
          <details className="text-view" open>
            <summary>All measurements as text</summary>
            <SheetTable snapshot={r.snapshot} />
          </details>
          {restoring && current.data?.fit && (
            <RestoreDialog
              revision={r}
              expectedLock={current.data.fit.lock_version}
              onClose={() => setRestoring(false)}
              onRestored={() => navigate(`/customers/${customerId}`)}
            />
          )}
          {switching && current.data?.fit && (
            <MakeCurrentDialog
              revision={r}
              expectedLock={current.data.fit.lock_version}
              paper={paper.data ? paperToSwitch(r, paper.data.photos, paper.data.currentPhotoId) : null}
              onClose={() => setSwitching(false)}
              onDone={() => navigate(`/customers/${customerId}`)}
            />
          )}
        </>
      )}
    </main>
  );
}
