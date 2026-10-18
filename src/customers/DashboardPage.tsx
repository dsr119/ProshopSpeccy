import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { getRecent } from '../lib/recent';
import { formatDateTime } from '../lib/format';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import {
  PAGE_SIZE,
  SORT_LABELS,
  initials,
  listRemovedCustomers,
  restoreCustomer,
  searchCustomers,
  splitName,
  type CustomerSearchRow,
  type CustomerSort,
  type RemovedCustomer,
} from './api';

export function DashboardPage() {
  const { userId } = useMembership();
  const navigate = useNavigate();
  const [query, setQuery] = useState(() => sessionStorage.getItem('proshop:lastQuery') ?? '');
  const [sort, setSort] = useState<CustomerSort>(() => {
    const saved = sessionStorage.getItem('proshop:sort');
    return saved && saved in SORT_LABELS ? (saved as CustomerSort) : 'last_name';
  });
  const [rows, setRows] = useState<CustomerSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const recent = getRecent(userId);
  const [params, setParams] = useSearchParams();
  const justRemoved = params.get('removed');
  const [undoError, setUndoError] = useState<AppError | null>(null);

  async function undoRemove(id: string) {
    setUndoError(null);
    try {
      await restoreCustomer(id);
      setParams({}, { replace: true });
      setRetry((r) => r + 1);
    } catch (e) {
      setUndoError(toAppError(e));
    }
  }

  useEffect(() => {
    sessionStorage.setItem('proshop:lastQuery', query);
    sessionStorage.setItem('proshop:sort', sort);
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      searchCustomers(query, 0, controller.signal, sort)
        .then((r) => {
          setRows(r);
          setTotal(r[0]?.total_count ?? 0);
          setActive(-1);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(toAppError(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, sort, retry]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const more = await searchCustomers(query, rows.length, undefined, sort);
      setRows((r) => [...r, ...more]);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Enter') {
      const target = rows[active] ?? (rows.length === 1 ? rows[0] : null);
      if (target) navigate(`/customers/${target.id}`);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const trimmed = query.trim();
  return (
    <main className="page">
      <div className="dashboard__head">
        <h1>Customers</h1>
        <Link to="/customers/new" className="btn btn--primary">
          Add customer
        </Link>
      </div>

      {justRemoved && (
        <Notice tone="success">
          {params.get('name') ?? 'The bowler'} was deleted.{' '}
          <button type="button" className="linklike" onClick={() => undoRemove(justRemoved)}>
            Undo
          </button>
        </Notice>
      )}
      <ErrorBanner error={undoError} />

      <div className="search">
        <label htmlFor="customer-search" className="search__label">
          Search by name or phone
        </label>
        <label className="search__sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as CustomerSort)}>
            {(Object.entries(SORT_LABELS) as Array<[CustomerSort, string]>).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <input
          id="customer-search"
          type="search"
          autoFocus
          autoComplete="off"
          placeholder="e.g. smith, or 555 0100"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls="customer-results"
          aria-activedescendant={active >= 0 ? `result-${rows[active]?.id}` : undefined}
        />
      </div>

      <ErrorBanner error={error} onRetry={() => setRetry((r) => r + 1)} />

      <section aria-labelledby="results-heading">
        <h2 id="results-heading" className="section-title">
          {trimmed ? 'Matches' : `Everyone, by ${SORT_LABELS[sort].toLowerCase()}`}
          {!loading && !error && total > 0 && <span className="muted"> ({total})</span>}
        </h2>
        {loading ? (
          <Spinner label="Searching…" />
        ) : !error && rows.length === 0 ? (
          trimmed ? (
            <p className="empty">
              No customers match “{trimmed}”. <Link to={`/customers/new?name=${encodeURIComponent(trimmed)}`}>Add a new customer</Link>
            </p>
          ) : (
            <p className="empty">
              No customers yet. <Link to="/customers/new">Add the first customer</Link>
            </p>
          )
        ) : (
          <ul id="customer-results" className="results" role="listbox" ref={listRef} aria-label="Customers">
            {rows.map((c, i) => {
              const { first, last } = splitName(c.name);
              return (
                <li key={c.id} id={`result-${c.id}`} role="option" aria-selected={i === active}>
                  <Link to={`/customers/${c.id}`} className={`result${i === active ? ' result--active' : ''}`}>
                    <span className="result__top">
                      <span className="result__avatar" aria-hidden="true">
                        {initials(c.name)}
                      </span>
                      <span className="result__who">
                        <span className="visually-hidden">{c.name}</span>
                        <span className="result__name" aria-hidden="true">
                          <span className="result__last">{last}</span>
                          {first && <span className="result__first">{first}</span>}
                        </span>
                        {c.phone && <span className="result__phone">{c.phone}</span>}
                      </span>
                    </span>
                    <span className="result__meta">
                      <span>
                        {c.spec_sheet_count} spec sheet{c.spec_sheet_count === 1 ? '' : 's'}
                      </span>
                      <span>
                        {c.ball_count} ball{c.ball_count === 1 ? '' : 's'}
                      </span>
                      <span className="visually-hidden">{c.has_specs ? 'Has digital specs' : 'No digital specs'}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && rows.length < total && (
          <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Show more (${total - rows.length} more)`}
          </button>
        )}
        {!loading && total > PAGE_SIZE && rows.length >= total && <p className="muted">All {total} shown.</p>}
      </section>

      <RemovedCustomers onRestored={() => setRetry((r) => r + 1)} />

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="recent">
          <h2 id="recent-heading" className="section-title">
            Recently viewed on this device
          </h2>
          <ul className="chips">
            {recent.map((r) => (
              <li key={r.id}>
                <Link to={`/customers/${r.id}`} className="chip">
                  {r.name}
                  {r.phone && <span className="muted"> · {r.phone}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** Bowlers deleted from the app, newest first, each with a way back. */
function RemovedCustomers({ onRestored }: { onRestored: () => void }) {
  const [rows, setRows] = useState<RemovedCustomer[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    listRemovedCustomers()
      .then(setRows)
      .catch((e) => setError(toAppError(e)));
  }, [open]);

  async function restore(id: string) {
    setError(null);
    try {
      await restoreCustomer(id);
      setRows((r) => r?.filter((x) => x.id !== id) ?? null);
      onRestored();
    } catch (e) {
      setError(toAppError(e));
    }
  }

  return (
    <details className="removed-list" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Recently deleted bowlers</summary>
      <ErrorBanner error={error} />
      {!rows ? (
        open && !error && <Spinner />
      ) : rows.length === 0 ? (
        <p className="muted">No deleted bowlers.</p>
      ) : (
        <ul className="intake-matches">
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.name}</strong>
                {r.phone && <span className="muted"> · {r.phone}</span>}
                <span className="muted small"> · deleted {formatDateTime(r.removed_at)}</span>
              </span>
              <button type="button" className="btn btn--small" onClick={() => restore(r.id)}>
                Bring back
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
