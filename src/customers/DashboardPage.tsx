import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { formatDate } from '../lib/format';
import { getRecent } from '../lib/recent';
import { ErrorBanner, Spinner } from '../components/ui';
import { PAGE_SIZE, searchCustomers, type CustomerSearchRow } from './api';

export function DashboardPage() {
  const { userId } = useMembership();
  const navigate = useNavigate();
  const [query, setQuery] = useState(() => sessionStorage.getItem('proshop:lastQuery') ?? '');
  const [rows, setRows] = useState<CustomerSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const recent = getRecent(userId);

  useEffect(() => {
    sessionStorage.setItem('proshop:lastQuery', query);
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      searchCustomers(query, 0, controller.signal)
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
  }, [query, retry]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const more = await searchCustomers(query, rows.length);
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

      <div className="search">
        <label htmlFor="customer-search" className="search__label">
          Search by name or phone
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
          {trimmed ? 'Matches' : 'Recently updated'}
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
            {rows.map((c, i) => (
              <li key={c.id} id={`result-${c.id}`} role="option" aria-selected={i === active}>
                <Link to={`/customers/${c.id}`} className={`result${i === active ? ' result--active' : ''}`}>
                  <span className="result__name">{c.name}</span>
                  <span className="result__meta">
                    {c.phone && <span>{c.phone}</span>}
                    <span>{c.last_spec_at ? `Specs updated ${formatDate(c.last_spec_at)}` : 'No digital specs'}</span>
                    {c.photo_count > 0 && <span>{c.photo_count} photo{c.photo_count === 1 ? '' : 's'}</span>}
                  </span>
                  {c.notes && <span className="result__notes">{c.notes}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!loading && rows.length < total && (
          <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Show more (${total - rows.length} more)`}
          </button>
        )}
        {!loading && total > PAGE_SIZE && rows.length >= total && <p className="muted">All {total} shown.</p>}
      </section>

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
