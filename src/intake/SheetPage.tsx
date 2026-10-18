import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Dialog, ErrorBanner, Notice, Spinner } from '../components/ui';
import { EditFitPage } from '../fits/EditFitPage';
import { CustomerFields } from '../customers/NewCustomerPage';
import {
  EMPTY_CUSTOMER,
  createCustomer,
  searchCustomers,
  validateCustomer,
  type CustomerInput,
  type CustomerSearchRow,
} from '../customers/api';
import { claimNext, finishItem, getItem, intakePhotoUrl, releaseItem, type CopiedPhotos, type IntakeItem } from './api';
import { appCustomerUrl } from './IntakeHome';

const bowlerKey = (itemId: string) => `proshop:intake:bowler:${itemId}`;

function readBowler(itemId: string): string | null {
  try {
    return sessionStorage.getItem(bowlerKey(itemId));
  } catch {
    return null;
  }
}

function keepBowler(itemId: string, customerId: string | null) {
  try {
    if (customerId) sessionStorage.setItem(bowlerKey(itemId), customerId);
    else sessionStorage.removeItem(bowlerKey(itemId));
  } catch {
    // The choice is still kept in memory.
  }
}

/** One paper sheet from the queue: its photo beside the bowler search, then the digital sheet. */
export function SheetPage() {
  const { itemId = '' } = useParams();
  const name = useOutletContext<string>();
  const navigate = useNavigate();
  const item = useAsync(() => getItem(itemId), [itemId]);
  const [customerId, setCustomerId] = useState<string | null>(() => readBowler(itemId));
  const [error, setError] = useState<AppError | null>(null);
  const [settingAside, setSettingAside] = useState(false);
  const copied = useRef<CopiedPhotos>({});

  useEffect(() => {
    setCustomerId(readBowler(itemId));
    copied.current = {};
  }, [itemId]);

  function chooseBowler(id: string | null) {
    keepBowler(itemId, id);
    setCustomerId(id);
  }

  async function putBack() {
    setError(null);
    try {
      await releaseItem(itemId);
      keepBowler(itemId, null);
      navigate('/');
    } catch (e) {
      setError(toAppError(e));
    }
  }

  if (item.loading) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }
  if (item.error || !item.data) {
    return (
      <main className="page">
        <p className="breadcrumb">
          <Link to="/">← Queue</Link>
        </p>
        <ErrorBanner error={item.error ?? 'Sheet not found'} onRetry={item.reload} />
      </main>
    );
  }

  const it = item.data;
  if (it.status === 'done') {
    return (
      <main className="page">
        <p className="breadcrumb">
          <Link to="/">← Queue</Link>
        </p>
        <Notice tone="success">
          This sheet is already in the app{it.done_by ? `, typed in by ${it.done_by}` : ''}.{' '}
          {it.customer_id && (
            <a href={appCustomerUrl(it.customer_id)} target="_blank" rel="noreferrer">
              Open it in the app
            </a>
          )}
        </Notice>
      </main>
    );
  }

  const someoneElse = it.status === 'working' && it.claimed_by && it.claimed_by !== name;

  return (
    <div className="intake-work">
      <SheetPhoto item={it} />
      <div className="intake-work__form">
        <div className="intake-work__bar">
          <Link to="/" className="breadcrumb">
            ← Queue
          </Link>
          <button type="button" className="btn btn--small" onClick={putBack}>
            Put back in the queue
          </button>
          <button type="button" className="btn btn--small" onClick={() => setSettingAside(true)}>
            Can't read it
          </button>
        </div>
        <ErrorBanner error={error} />
        {someoneElse && (
          <Notice tone="warn">
            {it.claimed_by} opened this sheet {it.claimed_at ? `at ${formatDateTime(it.claimed_at)}` : ''}. Check with them before
            typing it in.
          </Notice>
        )}
        {it.status !== 'working' && !someoneElse && (
          <Notice>This sheet is {it.status === 'unreadable' ? 'set aside as unreadable' : 'waiting in the queue'}.</Notice>
        )}

        {customerId ? (
          <>
            <p className="intake-step">
              <strong>2. Type in the sheet.</strong>{' '}
              <button type="button" className="linklike" onClick={() => chooseBowler(null)}>
                Wrong bowler?
              </button>
            </p>
            <EditFitPage
              key={customerId}
              embed={{
                customerId,
                saveLabel: 'Save and send to the app',
                onCancel: () => chooseBowler(null),
                onSaved: async (result) => {
                  await finishItem(it, customerId, result.revision_id, name, copied.current);
                  keepBowler(itemId, null);
                  const next = await claimNext(name).catch(() => null);
                  navigate(next ? `/sheet/${next.id}` : '/?finished=1&empty=1');
                },
              }}
            />
          </>
        ) : (
          <FindBowler onChoose={chooseBowler} />
        )}
      </div>

      <SetAsideDialog
        open={settingAside}
        onClose={() => setSettingAside(false)}
        onDone={async (note) => {
          await releaseItem(itemId, true, note);
          keepBowler(itemId, null);
          navigate('/');
        }}
      />
    </div>
  );
}

/** The paper sheet, zoomable and turnable, kept in view while typing; front and back when it has both. */
function SheetPhoto({ item }: { item: IntakeItem }) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const path = side === 'back' && item.back_path ? item.back_path : item.object_path;
  const url = useAsync(() => intakePhotoUrl(item, path), [path]);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  return (
    <aside className="intake-photo" aria-label="Paper spec sheet">
      <div className="intake-photo__tools">
        {item.back_path && (
          <div className="intake-photo__sides" role="group" aria-label="Side">
            {(['front', 'back'] as const).map((s) => (
              <button key={s} type="button" className="btn btn--small" aria-pressed={side === s} onClick={() => setSide(s)}>
                {s === 'front' ? 'Front' : 'Back'}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn--small" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
          −
        </button>
        <button type="button" className="btn btn--small" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>
          +
        </button>
        <button type="button" className="btn btn--small" onClick={() => setTurn((t) => (t + 90) % 360)}>
          Turn
        </button>
        {url.data && (
          <a className="btn btn--small" href={url.data} target="_blank" rel="noreferrer">
            Full size
          </a>
        )}
      </div>
      <div className="intake-photo__frame">
        {url.error ? (
          <ErrorBanner error={url.error} onRetry={url.reload} />
        ) : url.data ? (
          <img
            src={url.data}
            alt="Paper spec sheet"
            style={{ width: `${zoom * 100}%`, transform: turn ? `rotate(${turn}deg)` : undefined }}
          />
        ) : (
          <Spinner />
        )}
      </div>
    </aside>
  );
}

/** Step 1: find the bowler on the sheet, or add them. */
function FindBowler({ onChoose }: { onChoose: (customerId: string) => void }) {
  const { shop_id } = useMembership();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CustomerSearchRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState<CustomerInput>(EMPTY_CUSTOMER);
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInput, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setRows(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchCustomers(query.trim(), 0, ctrl.signal, 'name')
        .then((r) => setRows(r.slice(0, 8)))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const errs = validateCustomer(value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    try {
      onChoose((await createCustomer(shop_id, value)).id);
    } catch (err) {
      setError(toAppError(err));
      setSaving(false);
    }
  }

  if (adding) {
    return (
      <section className="intake-bowler">
        <p className="intake-step">
          <strong>1. Add the bowler.</strong> Copy the details from the top of the paper sheet.
        </p>
        <ErrorBanner error={error} />
        <form className="form" onSubmit={create} noValidate>
          <CustomerFields value={value} onChange={setValue} errors={errors} />
          <div className="form__actions">
            <button className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add bowler and continue'}
            </button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Back to search
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="intake-bowler">
      <p className="intake-step">
        <strong>1. Find the bowler.</strong> They may already be in the app.
      </p>
      <label>
        Name or phone on the sheet
        <input type="search" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
      </label>
      {rows && rows.length > 0 && (
        <ul className="intake-matches">
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.name}</strong>
                {r.phone && <span className="muted"> · {r.phone}</span>}
                {r.has_specs && <span className="muted small"> · has a digital sheet</span>}
              </span>
              <button type="button" className="btn btn--small" onClick={() => onChoose(r.id)}>
                This bowler
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length === 0 && <p className="muted">No bowler by that name yet.</p>}
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => {
          setValue({ ...EMPTY_CUSTOMER, name: /\d{3}/.test(query) ? '' : query.trim(), phone: /\d{3}/.test(query) ? query.trim() : '' });
          setAdding(true);
        }}
      >
        Add a new bowler
      </button>
    </section>
  );
}

function SetAsideDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <Dialog
      open={open}
      title="Set this sheet aside?"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onDone(note);
              } catch (e) {
                setError(toAppError(e));
                setBusy(false);
              }
            }}
          >
            Set aside
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <p>It leaves the queue until someone puts it back. Say what's wrong so the next person knows.</p>
      <label>
        What's wrong <span className="muted">(optional)</span>
        <input value={note} maxLength={500} placeholder="e.g. Blurry, retake the photo" onChange={(e) => setNote(e.target.value)} />
      </label>
    </Dialog>
  );
}
