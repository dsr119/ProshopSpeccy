import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { formatDate, formatDateTime } from '../lib/format';
import { addRecent, forgetRecent } from '../lib/recent';
import { useAsync } from '../lib/useAsync';
import { Dialog, ErrorBanner, Notice, Spinner } from '../components/ui';
import { HAND_LABELS, THUMB_MODE_LABELS, type Hand, type Snapshot, type ThumbMode } from '../measurements/schema';
import { SheetTable, SpecSheet, displayFromSnapshot } from '../template/SpecSheet';
import { getCurrentFit, isConfirmed, listUncheckedSheets, setFitConfirmed, type Fit } from '../fits/api';
import { listPhotos } from '../photos/api';
import { PhotosPanel } from '../photos/PhotosPage';
import { listBalls } from '../balls/api';
import { BallsList } from '../balls/BallsSection';
import { BowlerCard } from './BowlerCard';
import { customerInput, getCustomer, removeCustomer, updateCustomer, validateCustomer, type Customer, type CustomerInput } from './api';
import { CustomerFields } from './NewCustomerPage';

export function FitIdentity({ snapshot }: { snapshot: Snapshot | null }) {
  const hand = snapshot?.hand as Hand | null;
  const mode = snapshot?.thumb_mode as ThumbMode | null;
  return (
    <p className="fit-identity">
      <span className="tag">{hand ? HAND_LABELS[hand] : 'Hand not recorded'}</span>
      <span className="tag">{mode ? (THUMB_MODE_LABELS[mode] ?? mode) : 'Grip not recorded'}</span>
      {typeof snapshot?.fit_label === 'string' && <span className="tag tag--plain">{snapshot.fit_label}</span>}
    </p>
  );
}

export function FitNotes({ snapshot }: { snapshot: Snapshot | null }) {
  const noThumb = snapshot?.thumb_mode === 'no_thumb';
  const items: Array<[string, unknown]> = [
    ['Finger inserts', snapshot?.finger_insert_details],
    ...(noThumb ? [] : ([['Thumb system', snapshot?.thumb_system_details]] as Array<[string, unknown]>)),
    ['Notes', snapshot?.fitting_notes],
  ];
  return (
    <dl className="fit-notes">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={typeof value === 'string' ? 'prewrap' : 'muted'}>{typeof value === 'string' ? value : 'Not recorded'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The switch for marking the digital sheet as checked against the paper one. Saving new measurements clears it. */
function ConfirmSheet({ fit, onChange }: { fit: Fit; onChange: (fit: Fit) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const confirmed = isConfirmed(fit);
  const changedSince = !confirmed && !!fit.confirmed_revision_id;

  async function toggle(next: boolean) {
    if (!fit.current_revision_id) return;
    setBusy(true);
    setError(null);
    try {
      onChange({ ...fit, ...(await setFitConfirmed(fit.id, fit.current_revision_id, next)) });
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`confirm-sheet no-print${confirmed ? ' confirm-sheet--on' : ''}`}>
      <ErrorBanner error={error} />
      <label className="switch">
        <input type="checkbox" role="switch" checked={confirmed} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span className="switch__track" aria-hidden="true" />
        <span>
          Digital spec sheet confirmed
          {confirmed && fit.confirmed_at && (
            <span className="muted small">
              {' '}
              · {formatDateTime(fit.confirmed_at)}
              {fit.confirmed_by ? ` by ${fit.confirmed_by}` : ''}
            </span>
          )}
          {changedSince && <span className="muted small"> · measurements changed since it was last confirmed</span>}
        </span>
      </label>
    </div>
  );
}

export function CustomerPage() {
  const { customerId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { userId } = useMembership();
  const customer = useAsync(() => getCustomer(customerId), [customerId]);
  const fit = useAsync(() => getCurrentFit(customerId), [customerId]);
  const photos = useAsync(() => listPhotos(customerId), [customerId]);
  const balls = useAsync(() => listBalls(customerId), [customerId]);
  const currentFit = fit.data?.fit ?? null;
  const currentNumber = fit.data?.revision?.revision_number ?? 0;
  const unchecked = useAsync(
    async () => (currentFit ? listUncheckedSheets(currentFit, currentNumber) : []),
    [currentFit?.id, currentNumber],
  );
  const [enlarged, setEnlarged] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();
  const view = params.get('view') === 'photos' ? 'photos' : 'sheet';

  useEffect(() => {
    const c = customer.data;
    if (c) addRecent(userId, { id: c.id, name: c.name, phone: c.phone });
  }, [customer.data, userId]);

  if (customer.loading) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }
  if (customer.error || !customer.data) {
    return (
      <main className="page">
        <p className="breadcrumb">
          <Link to="/">← Customers</Link>
        </p>
        <ErrorBanner error={customer.error ?? 'Customer not found'} onRetry={customer.reload} />
      </main>
    );
  }

  const c = customer.data;
  const revision = fit.data?.revision ?? null;
  const snapshot = revision?.snapshot ?? null;
  const photoList = photos.data ?? [];
  const show = (next: 'sheet' | 'photos') => setParams(next === 'photos' ? { view: 'photos' } : {}, { replace: true });

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/">← Customers</Link>
      </p>

      <BowlerCard
        customer={c}
        date={revision ? formatDate(revision.created_at) : null}
        hand={snapshot?.hand as string | null}
        playStyle={snapshot?.play_style as string | null}
        actions={
          <span className="bowler__actions no-print">
            <button type="button" className="btn btn--small" onClick={() => setEditingDetails(true)}>
              Edit bowler details
            </button>
            <button type="button" className="btn btn--small btn--danger-outline" onClick={() => setRemoving(true)}>
              Delete bowler
            </button>
          </span>
        }
      />

      {params.get('created') && (
        <Notice tone="success">
          Customer created. Next: <Link to={`/customers/${c.id}/edit`}>Create digital specs</Link> or{' '}
          <Link to={`/customers/${c.id}?view=photos&upload=1`}>Add a photo</Link>.
        </Notice>
      )}

      {params.get('nochange') && <Notice>No changes were made, so no new revision was saved.</Notice>}

      <div className="view-tabs no-print" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'sheet'} onClick={() => show('sheet')}>
          Digital spec sheet
        </button>
        <button type="button" aria-pressed={view === 'photos'} onClick={() => show('photos')}>
          Photos ({photoList.length})
        </button>
      </div>

      {view === 'photos' ? (
        <>
          <ErrorBanner error={photos.error} onRetry={photos.reload} />
          {photos.loading ? (
            <Spinner />
          ) : (
            <PhotosPanel
              customer={c}
              revisionId={revision?.id ?? null}
              revisionNumber={revision?.revision_number ?? null}
              photos={photoList}
              onChange={photos.setData}
              startUpload={params.get('upload') === '1'}
              onBallsSaved={balls.reload}
            />
          )}
        </>
      ) : (
        <section className="customer-sheet" aria-label="Digital spec sheet">
          <nav className="actions no-print" aria-label="Spec sheet actions">
            <Link className="btn btn--primary" to={`/customers/${c.id}/edit`}>
              {revision ? 'Edit measurements' : 'Create digital specs'}
            </Link>
            <Link className="btn" to={`/customers/${c.id}/history`}>
              History
            </Link>
            <Link className="btn" to={`/customers/${c.id}/print`}>
              Print
            </Link>
          </nav>

          <ErrorBanner error={fit.error} onRetry={fit.reload} />

          {revision && (
            <p className="muted saved-by">
              Last saved {formatDateTime(revision.created_at)} by {revision.author_name ?? 'unknown'} · revision #
              {revision.revision_number}
            </p>
          )}

          {(unchecked.data ?? []).map((r) => (
            <Notice key={r.id} tone="warn">
              <span>
                Another paper sheet for this bowler was read by AI and is not checked yet (revision #{r.revision_number}).
                Compare it with this sheet and the paper photo, and restore it if it is right.
              </span>{' '}
              <Link to={`/customers/${c.id}/history/${r.id}`}>Compare it</Link>
            </Notice>
          ))}

          {fit.loading ? (
            <Spinner />
          ) : revision ? (
            <>
              {fit.data?.fit && (
                <ConfirmSheet fit={fit.data.fit} onChange={(next) => fit.setData({ fit: next, revision })} />
              )}
              <FitIdentity snapshot={snapshot} />
              <SpecSheet display={displayFromSnapshot(snapshot)} />
              <button type="button" className="btn btn--small no-print" onClick={() => setEnlarged(true)}>
                Enlarge sheet
              </button>
              <FitNotes snapshot={snapshot} />
              <details className="text-view">
                <summary>All measurements as text</summary>
                <SheetTable snapshot={snapshot} />
              </details>
            </>
          ) : (
            <div className="empty-fit">
              <p>
                <strong>No digital specs yet.</strong>
                {photoList.length > 0 ? ' This customer has photos only.' : ''}
              </p>
              <Link className="btn btn--primary" to={`/customers/${c.id}/edit`}>
                Create digital specs
              </Link>
            </div>
          )}

          <ErrorBanner error={balls.error} onRetry={balls.reload} />
          {balls.data && <BallsList balls={balls.data} />}
        </section>
      )}

      <Dialog
        open={enlarged}
        title={`${c.name} — spec sheet`}
        onClose={() => setEnlarged(false)}
        wide
        actions={
          <button type="button" className="btn" onClick={() => setEnlarged(false)}>
            Close
          </button>
        }
      >
        {enlarged && <SpecSheet display={displayFromSnapshot(snapshot)} />}
      </Dialog>

      {removing && (
        <RemoveCustomerDialog
          customer={c}
          onClose={() => setRemoving(false)}
          onRemoved={() => {
            forgetRecent(userId, c.id);
            navigate(`/?removed=${c.id}&name=${encodeURIComponent(c.name)}`);
          }}
        />
      )}

      {editingDetails && (
        <EditCustomerDialog
          customer={c}
          onClose={() => setEditingDetails(false)}
          onSaved={(next) => {
            customer.setData(next);
            setEditingDetails(false);
          }}
        />
      )}
    </main>
  );
}

function RemoveCustomerDialog({ customer, onClose, onRemoved }: { customer: Customer; onClose: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <Dialog
      open
      title={`Delete ${customer.name}?`}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await removeCustomer(customer.id);
                onRemoved();
              } catch (e) {
                setError(toAppError(e));
                setBusy(false);
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete bowler'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Keep
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <p>
        They disappear from the customer list and search, with their spec sheet, balls and photos. If it was a mistake, bring
        them back from "Recently deleted bowlers" at the bottom of the customer list.
      </p>
    </Dialog>
  );
}

export function EditCustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const [value, setValue] = useState<CustomerInput>(() => customerInput(customer));
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInput, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateCustomer(value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateCustomer(customer.id, value));
    } catch (err) {
      setError(toAppError(err));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Edit bowler details"
      onClose={onClose}
      actions={
        <>
          <button type="submit" form="edit-customer" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <form id="edit-customer" className="form" onSubmit={submit} noValidate>
        <CustomerFields value={value} onChange={setValue} errors={errors} />
      </form>
    </Dialog>
  );
}
