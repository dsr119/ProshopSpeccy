import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { addRecent } from '../lib/recent';
import { useAsync } from '../lib/useAsync';
import { Dialog, ErrorBanner, Notice, Spinner } from '../components/ui';
import { HAND_LABELS, THUMB_MODE_LABELS, type Hand, type Snapshot, type ThumbMode } from '../measurements/schema';
import { SheetTable, SpecSheet, displayFromSnapshot } from '../template/SpecSheet';
import { getCurrentFit } from '../fits/api';
import { listPhotos, signedUrls, type SpecPhoto } from '../photos/api';
import { PhotoViewer } from '../photos/PhotoViewer';
import { getCustomer, updateCustomer, validateCustomer, type Customer, type CustomerInput } from './api';
import { CustomerFields } from './NewCustomerPage';

export function FitIdentity({ snapshot }: { snapshot: Snapshot | null }) {
  const hand = snapshot?.hand as Hand | null;
  const mode = snapshot?.thumb_mode as ThumbMode | null;
  return (
    <p className="fit-identity">
      <span className="tag">{hand ? HAND_LABELS[hand] : 'Hand not recorded'}</span>
      <span className="tag">{mode ? THUMB_MODE_LABELS[mode] : 'Thumb mode not recorded'}</span>
      {typeof snapshot?.fit_label === 'string' && <span className="tag tag--plain">{snapshot.fit_label}</span>}
    </p>
  );
}

export function FitNotes({ snapshot }: { snapshot: Snapshot | null }) {
  const items: Array<[string, unknown]> = [
    ['Finger inserts', snapshot?.finger_insert_details],
    ['Thumb system', snapshot?.thumb_system_details],
    ['Fitting notes', snapshot?.fitting_notes],
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

export function CustomerPage() {
  const { customerId = '' } = useParams();
  const [params] = useSearchParams();
  const { userId } = useMembership();
  const customer = useAsync(() => getCustomer(customerId), [customerId]);
  const fit = useAsync(() => getCurrentFit(customerId), [customerId]);
  const photos = useAsync(() => listPhotos(customerId), [customerId]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selectedPhoto, setSelectedPhoto] = useState<SpecPhoto | null>(null);
  const [mobileView, setMobileView] = useState<'sheet' | 'photo'>('sheet');
  const [enlarged, setEnlarged] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);

  useEffect(() => {
    const c = customer.data;
    if (c) addRecent(userId, { id: c.id, name: c.name, phone: c.phone });
  }, [customer.data, userId]);

  useEffect(() => {
    const list = photos.data ?? [];
    setSelectedPhoto((p) => p ?? list[0] ?? null);
    signedUrls(list.map((p) => p.object_path))
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [photos.data]);

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

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/">← Customers</Link>
      </p>

      <div className="customer-head">
        <div>
          <h1>{c.name}</h1>
          <p className="muted">
            {c.phone ?? 'No phone'}
            {c.notes && <> · {c.notes}</>}
          </p>
          <FitIdentity snapshot={snapshot} />
        </div>
        <button type="button" className="btn btn--small" onClick={() => setEditingDetails(true)}>
          Edit customer details
        </button>
      </div>

      {params.get('created') && (
        <Notice tone="success">
          Customer created. Next: <Link to={`/customers/${c.id}/edit`}>Create digital specs</Link> or{' '}
          <Link to={`/customers/${c.id}/photos?upload=1`}>Upload original sheet</Link>.
        </Notice>
      )}

      {params.get('nochange') && <Notice>No changes were made, so no new revision was saved.</Notice>}

      <nav className="actions no-print" aria-label="Customer actions">
        <Link className="btn btn--primary" to={`/customers/${c.id}/edit`}>
          {revision ? 'Edit measurements' : 'Create digital specs'}
        </Link>
        <Link className="btn" to={`/customers/${c.id}/photos?upload=1`}>
          Upload sheet
        </Link>
        <Link className="btn" to={`/customers/${c.id}/photos`}>
          Original photos ({photoList.length})
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

      {photoList.length > 0 && (
        <div className="view-toggle" role="group" aria-label="Show">
          <button type="button" aria-pressed={mobileView === 'sheet'} onClick={() => setMobileView('sheet')}>
            Digital sheet
          </button>
          <button type="button" aria-pressed={mobileView === 'photo'} onClick={() => setMobileView('photo')}>
            Original photo
          </button>
        </div>
      )}

      <div className={`compare compare--show-${mobileView}${photoList.length ? ' compare--with-photo' : ''}`}>
        <section className="compare__sheet" aria-label="Digital spec sheet">
          {fit.loading ? (
            <Spinner />
          ) : revision ? (
            <>
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
                {photoList.length > 0 ? ' This customer has original sheet photos only.' : ''}
              </p>
              <Link className="btn btn--primary" to={`/customers/${c.id}/edit`}>
                Create digital specs
              </Link>
            </div>
          )}
        </section>

        {photoList.length > 0 && (
          <section className="compare__photo" aria-label="Original sheet photo">
            {photoList.length > 1 && (
              <label className="inline-label">
                Photo{' '}
                <select
                  value={selectedPhoto?.id ?? ''}
                  onChange={(e) => setSelectedPhoto(photoList.find((p) => p.id === e.target.value) ?? null)}
                >
                  {photoList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.caption || 'Untitled'} · {formatDateTime(p.created_at)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedPhoto && <PhotoViewer photo={selectedPhoto} url={urls[selectedPhoto.object_path]} />}
          </section>
        )}
      </div>

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

function EditCustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const [value, setValue] = useState<CustomerInput>({
    name: customer.name,
    phone: customer.phone ?? '',
    notes: customer.notes ?? '',
  });
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
      title="Edit customer details"
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
