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
  findPossibleDuplicates,
  searchCustomers,
  validateCustomer,
  type CustomerInput,
  type CustomerSearchRow,
  type DuplicateRow,
} from '../customers/api';
import {
  finishAndNext,
  getItem,
  intakePhotoUrl,
  passAndNext,
  PASS_REASONS,
  preloadUpNext,
  releaseItem,
  removeItem,
  type CopiedPhotos,
  type IntakeItem,
  type PassReason,
  isAdminName,
} from './api';
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
  const [passing, setPassing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const copied = useRef<CopiedPhotos>({});

  useEffect(() => {
    setCustomerId(readBowler(itemId));
    copied.current = {};
  }, [itemId]);

  // While this sheet is typed in, the next one's photos download in the background.
  const working = item.data?.status === 'working';
  useEffect(() => {
    if (working) preloadUpNext(itemId).catch(() => undefined);
  }, [itemId, working]);

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
          <button type="button" className="btn btn--small" onClick={() => setPassing(true)}>
            Pass
          </button>
          <button type="button" className="btn btn--small btn--danger-outline" onClick={() => setRemoving(true)}>
            Delete sheet
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
          <Notice>This sheet is {it.status === 'unreadable' ? 'in the passed pile' : 'waiting in the queue'}.</Notice>
        )}
        {(it.pass_reason || it.passed_at) && <PassedNote item={it} />}
        {it.back_path && (
          <Notice tone="warn">
            <strong>This paper has a back.</strong> Tap Back on the photo to see what's written on it.
          </Notice>
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
                  const next = await finishAndNext(it, customerId, result.revision_id, name, copied.current);
                  keepBowler(itemId, null);
                  navigate(next ? `/sheet/${next.id}` : '/?finished=1&empty=1');
                },
              }}
            />
          </>
        ) : (
          <ChooseBowler key={it.id} onChoose={chooseBowler} suggested={it} />
        )}
      </div>

      <RemoveSheetDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onDone={async () => {
          await removeItem(itemId, name);
          keepBowler(itemId, null);
          navigate(`/?removed=${itemId}`);
        }}
      />

      <PassDialog
        key={itemId}
        reasonOptional={isAdminName(name)}
        open={passing}
        onClose={() => setPassing(false)}
        onDone={async (reason, note) => {
          const next = await passAndNext(it, reason, note, name);
          keepBowler(itemId, null);
          setPassing(false);
          navigate(next ? `/sheet/${next.id}` : '/?passed=1&empty=1');
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

/** Step 1: check the name and phone read off the photo when there is one, else search for the bowler. */
function ChooseBowler({ onChoose, suggested }: { onChoose: (customerId: string) => void; suggested: IntakeItem }) {
  const [searching, setSearching] = useState(!suggested.read_name && !suggested.read_phone);
  return searching ? (
    <FindBowler onChoose={onChoose} suggested={suggested} />
  ) : (
    <CheckBowler onChoose={onChoose} suggested={suggested} onSearch={() => setSearching(true)} />
  );
}

/** The name and phone read off the photo, to fix if needed, with any bowler already in the app that matches. */
function CheckBowler({
  onChoose,
  suggested,
  onSearch,
}: {
  onChoose: (customerId: string) => void;
  suggested: IntakeItem;
  onSearch: () => void;
}) {
  const { shop_id } = useMembership();
  const [value, setValue] = useState<CustomerInput>({
    ...EMPTY_CUSTOMER,
    name: suggested.read_name ?? '',
    phone: suggested.read_phone ?? '',
  });
  const [matches, setMatches] = useState<DuplicateRow[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInput, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    const name = value.name.trim();
    const phone = value.phone.trim();
    if (name.length < 2 && phone.replace(/\D/g, '').length < 7) {
      setMatches(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      findPossibleDuplicates(name, phone)
        .then((r) => live && setMatches(r))
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value.name, value.phone]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const errs = validateCustomer(value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    try {
      onChoose((await createCustomer(shop_id, { ...value, name: value.name.trim(), phone: value.phone.trim() })).id);
    } catch (err) {
      setError(toAppError(err));
      setSaving(false);
    }
  }

  return (
    <section className="intake-bowler">
      <p className="intake-step">
        <strong>1. Check the name and phone.</strong> These were read off the photo. Fix anything that doesn't match the sheet.
      </p>
      {suggested.read_unsure && <Notice tone="warn">Some of this was hard to read. Look closely at the sheet.</Notice>}
      <ErrorBanner error={error} />
      <form className="form" onSubmit={create} noValidate>
        <label>
          Name
          <input
            value={value.name}
            autoFocus
            maxLength={200}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            aria-invalid={!!errors.name}
          />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          Phone <span className="muted">{suggested.read_phone ? '' : '(none read off the sheet)'}</span>
          <input
            type="tel"
            value={value.phone}
            maxLength={40}
            onChange={(e) => setValue({ ...value, phone: e.target.value })}
            aria-invalid={!!errors.phone}
          />
          {errors.phone && <span className="field-error">{errors.phone}</span>}
        </label>
        {matches && matches.length > 0 && (
          <>
            <p className="muted small">Already in the app? Pick them so the sheet goes on their page.</p>
            <ul className="intake-matches">
              {matches.map((r) => (
                <li key={r.id}>
                  <span>
                    <strong>{r.name}</strong>
                    {r.phone && <span className="muted"> · {r.phone}</span>}
                    <span className="muted small"> · {r.reason}</span>
                  </span>
                  <button type="button" className="btn btn--small" onClick={() => onChoose(r.id)}>
                    This bowler
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : matches && matches.length > 0 ? "It's someone new, add them" : 'Looks right, add bowler'}
          </button>
          <button type="button" className="btn" onClick={onSearch}>
            Search instead
          </button>
        </div>
      </form>
    </section>
  );
}

/** Find the bowler on the sheet, or add them. */
function FindBowler({ onChoose, suggested }: { onChoose: (customerId: string) => void; suggested: IntakeItem }) {
  const { shop_id } = useMembership();
  const readName = suggested.read_name ?? '';
  const readPhone = suggested.read_phone ?? '';
  const [query, setQuery] = useState(readName || readPhone);
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
      {(readName || readPhone) && (
        <p className="muted small">
          Read off the photo: <strong>{[readName, readPhone].filter(Boolean).join(' · ')}</strong>
          {suggested.read_unsure ? ' (hard to read, check it)' : ' (check it against the sheet)'}
        </p>
      )}
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
          const typedPhone = /\d{3}/.test(query);
          setValue({
            ...EMPTY_CUSTOMER,
            name: typedPhone ? readName : query.trim(),
            phone: typedPhone ? query.trim() : readPhone,
          });
          setAdding(true);
        }}
      >
        Add a new bowler
      </button>
    </section>
  );
}

function RemoveSheetDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <Dialog
      open={open}
      title="Delete this sheet from the queue?"
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
                await onDone();
              } catch (e) {
                setError(toAppError(e));
                setBusy(false);
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete sheet'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <p>Use this for a duplicate photo or one that isn't a spec sheet. If it was a mistake, bring it back from "Recently deleted sheets" on the queue page.</p>
    </Dialog>
  );
}

/** Who passed this sheet before, and why. */
function PassedNote({ item }: { item: IntakeItem }) {
  if (!item.pass_reason && !item.passed_at) return null;
  return (
    <p className="muted small" data-testid="passed-note">
      Passed{item.passed_by ? ` by ${item.passed_by}` : ''}
      {item.pass_reason && (
        <>
          : <strong>{PASS_REASONS[item.pass_reason]}</strong>
        </>
      )}
      {item.note ? ` · ${item.note}` : ''}
    </p>
  );
}

function PassDialog({
  open,
  onClose,
  onDone,
  reasonOptional,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (reason: PassReason | null, note: string) => Promise<void>;
  /** Signed in as admin, a sheet can be passed without a reason. */
  reasonOptional?: boolean;
}) {
  const [reason, setReason] = useState<PassReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <Dialog
      open={open}
      title="Pass this sheet?"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || (!reason && !reasonOptional)}
            onClick={async () => {
              if (!reason && !reasonOptional) return;
              setBusy(true);
              setError(null);
              try {
                await onDone(reason, note);
              } catch (e) {
                setError(toAppError(e));
                setBusy(false);
              }
            }}
          >
            {busy ? 'Passing…' : 'Pass and get the next one'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <p>It goes to the passed pile on the queue page, where someone can look at it later.</p>
      <fieldset className="pass-reasons">
        <legend>Why?{reasonOptional && <span className="muted"> (optional)</span>}</legend>
        {(Object.entries(PASS_REASONS) as Array<[PassReason, string]>).map(([key, label]) => (
          <label key={key} className={`pass-reason${reason === key ? ' is-on' : ''}`}>
            <input type="radio" name="pass-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        Note <span className="muted">(optional)</span>
        <input value={note} maxLength={500} placeholder="e.g. Ring span smudged" onChange={(e) => setNote(e.target.value)} />
      </label>
    </Dialog>
  );
}
