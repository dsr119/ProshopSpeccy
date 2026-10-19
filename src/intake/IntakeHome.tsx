import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { addIntakeName, claimNext, getCounts, getPeopleStats, isAdminName, listIntakeNames, listItems, listRemovedItems, releaseItem, removeItem, restoreItem, PASS_REASONS, type IntakeItem } from './api';

/** The app's own customer page, opened in a new tab. */
export const appCustomerUrl = (id: string) => `${import.meta.env.BASE_URL}customers/${id}`;

export function IntakeHome() {
  const name = useOutletContext<string>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const counts = useAsync(getCounts, []);
  const working = useAsync(() => listItems('working'), []);
  const unreadable = useAsync(() => listItems('unreadable'), []);
  const done = useAsync(() => listItems('done', 10), []);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [empty, setEmpty] = useState(false);

  async function next() {
    setClaiming(true);
    setError(null);
    setEmpty(false);
    try {
      const item = await claimNext(name);
      if (item) navigate(`/sheet/${item.id}`);
      else setEmpty(true);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setClaiming(false);
    }
  }

  function reloadAll() {
    unreadable.reload();
    working.reload();
    counts.reload();
  }

  async function remove(item: IntakeItem) {
    try {
      await removeItem(item.id, name);
      reloadAll();
    } catch (e) {
      setError(toAppError(e));
    }
  }

  async function undoRemove(id: string) {
    try {
      await restoreItem(id);
      setParams({}, { replace: true });
      reloadAll();
    } catch (e) {
      setError(toAppError(e));
    }
  }

  async function putBack(item: IntakeItem) {
    try {
      await releaseItem(item.id);
      unreadable.reload();
      working.reload();
      counts.reload();
    } catch (e) {
      setError(toAppError(e));
    }
  }

  const c = counts.data;
  return (
    <main className="page">
      <h1>Paper spec sheets</h1>
      {params.get('finished') && <Notice tone="success">That sheet is now in the app.</Notice>}
      {params.get('passed') && <Notice>That sheet is in the passed pile.</Notice>}
      {params.get('empty') && <Notice>The queue is empty. Nice work.</Notice>}
      {params.get('removed') && (
        <Notice tone="success">
          That sheet was deleted from the queue.{' '}
          <button type="button" className="linklike" onClick={() => undoRemove(params.get('removed')!)}>
            Undo
          </button>
        </Notice>
      )}
      <ErrorBanner error={counts.error ?? error} onRetry={counts.error ? counts.reload : undefined} />

      <dl className="intake-counts">
        {(
          [
            ['waiting', 'In the queue'],
            ['working', 'Being typed in'],
            ['unreadable', 'Passed'],
            ['done', 'In the app'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} data-count={key}>
            <dt>{label}</dt>
            <dd>{c ? c[key].toLocaleString() : '–'}</dd>
          </div>
        ))}
      </dl>

      <div className="intake-actions">
        <Link className="btn btn--primary btn--big" to="/add">
          Take photos of sheets
        </Link>
        <button type="button" className="btn btn--primary btn--big" onClick={next} disabled={claiming}>
          {claiming ? 'Getting the next sheet…' : 'Type in the next sheet'}
        </button>
      </div>
      {empty && <Notice>Nothing is waiting in the queue right now.</Notice>}

      {isAdminName(name) && <PeopleStats />}
      {isAdminName(name) && <NameList />}

      <ItemList
        title="Being typed in now"
        items={working.data}
        loading={working.loading}
        render={(i) => (
          <>
            <span>
              {i.claimed_by ?? 'Someone'} · since {i.claimed_at ? formatDateTime(i.claimed_at) : '?'}
            </span>
            {i.claimed_by === name && (
              <Link className="btn btn--small" to={`/sheet/${i.id}`}>
                Continue
              </Link>
            )}
          </>
        )}
      />
      <ItemList
        title="Passed sheets"
        items={unreadable.data}
        loading={unreadable.loading}
        render={(i) => (
          <>
            <span>
              <strong>{i.pass_reason ? PASS_REASONS[i.pass_reason] : 'Set aside'}</strong>
              {i.note && ` · ${i.note}`}{' '}
              <span className="muted small">· {i.passed_by ? `passed by ${i.passed_by}` : `added by ${i.added_by ?? 'unknown'}`}</span>
            </span>
            <span className="intake-actions--inline">
              <Link className="btn btn--small" to={`/sheet/${i.id}`}>
                Look at it
              </Link>
              <button type="button" className="btn btn--small" onClick={() => putBack(i)}>
                Put back in the queue
              </button>
              <button type="button" className="btn btn--small btn--danger-outline" onClick={() => remove(i)}>
                Delete
              </button>
            </span>
          </>
        )}
      />
      <ItemList
        title="Recently put in the app"
        items={done.data}
        loading={done.loading}
        render={(i) => (
          <>
            <span>
              {i.done_by ?? 'Someone'} · {i.done_at ? formatDateTime(i.done_at) : ''}
            </span>
            {i.customer_id && (
              <a className="btn btn--small" href={appCustomerUrl(i.customer_id)} target="_blank" rel="noreferrer">
                Open in the app
              </a>
            )}
          </>
        )}
      />
      <RemovedSheets onRestored={reloadAll} />
    </main>
  );
}

/** Admin only: how many sheets each person has typed in and photographed. */
function PeopleStats() {
  const stats = useAsync(getPeopleStats, []);
  return (
    <section className="intake-list intake-people" aria-label="Who has done what">
      <h2>Who has done what</h2>
      <ErrorBanner error={stats.error} onRetry={stats.reload} />
      {stats.loading ? (
        <Spinner />
      ) : !stats.data?.length ? (
        <p className="muted">Nobody has added or typed in a sheet yet.</p>
      ) : (
        <div className="intake-people__wrap">
          <table className="intake-people__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Typed in today</th>
                <th scope="col">This week</th>
                <th scope="col">All time</th>
                <th scope="col">Photos taken</th>
                <th scope="col">Open now</th>
              </tr>
            </thead>
            <tbody>
              {stats.data.map((p) => (
                <tr key={p.name.toLowerCase()}>
                  <th scope="row">{p.name}</th>
                  <td>{p.typed_today.toLocaleString()}</td>
                  <td>{p.typed_week.toLocaleString()}</td>
                  <td>{p.typed_total.toLocaleString()}</td>
                  <td>{p.added_total.toLocaleString()}</td>
                  <td>{p.working_now.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Names are grouped as typed, ignoring capitals. The week starts on Monday.{' '}
        <button type="button" className="linklike" onClick={stats.reload}>
          Refresh
        </button>
      </p>
    </section>
  );
}

/** Admin only: the names people pick from to sign in, and a way to add one. */
function NameList() {
  const { membership } = useAuth();
  const names = useAsync(listIntakeNames, []);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!membership || !value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const name = await addIntakeName(membership.shop_id, value);
      setAdded(name);
      setValue('');
      names.reload();
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="intake-list intake-names-admin" aria-label="Names on the sign-in list">
      <h2>Names on the sign-in list</h2>
      <ErrorBanner error={names.error} onRetry={names.reload} />
      {names.loading ? <Spinner /> : <p>{names.data?.length ? names.data.join(', ') : 'No names yet.'}</p>}
      <form className="intake-names-admin__form" onSubmit={add}>
        <label>
          Add a name
          <input value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} placeholder="First and last name" />
        </label>
        <button type="submit" className="btn btn--primary" disabled={saving || !value.trim()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error && <ErrorBanner error={error} />}
      {added && !error && (
        <p className="muted small" role="status">
          {added} is on the list.
        </p>
      )}
    </section>
  );
}

/** Sheets deleted from the queue, each with a way back. */
function RemovedSheets({ onRestored }: { onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<IntakeItem[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function load() {
    try {
      setRows(await listRemovedItems());
    } catch (e) {
      setError(toAppError(e));
    }
  }

  async function restore(id: string) {
    setError(null);
    try {
      await restoreItem(id);
      setRows((r) => r?.filter((x) => x.id !== id) ?? null);
      onRestored();
    } catch (e) {
      setError(toAppError(e));
    }
  }

  return (
    <details
      className="removed-list"
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (isOpen) load();
      }}
    >
      <summary>Recently deleted sheets</summary>
      <ErrorBanner error={error} />
      {!rows ? (
        open && !error && <Spinner />
      ) : rows.length === 0 ? (
        <p className="muted">No deleted sheets.</p>
      ) : (
        <ul className="intake-matches">
          {rows.map((i) => (
            <li key={i.id}>
              <span>
                Added by {i.added_by ?? 'unknown'}
                <span className="muted small">
                  {' '}
                  · deleted {i.removed_at ? formatDateTime(i.removed_at) : ''}
                  {i.removed_by ? ` by ${i.removed_by}` : ''}
                </span>
              </span>
              <button type="button" className="btn btn--small" onClick={() => restore(i.id)}>
                Bring back
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function ItemList({
  title,
  items,
  loading,
  render,
}: {
  title: string;
  items: IntakeItem[] | null;
  loading: boolean;
  render: (item: IntakeItem) => ReactNode;
}) {
  if (loading) return <Spinner />;
  if (!items?.length) return null;
  return (
    <section className="intake-list">
      <h2>{title}</h2>
      <ul>
        {items.map((i) => (
          <li key={i.id}>{render(i)}</li>
        ))}
      </ul>
    </section>
  );
}
