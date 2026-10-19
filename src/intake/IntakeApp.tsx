// The paper spec sheet intake page, a separate page from the app (served at
// /intake/). Photos of paper sheets go into a queue; shop staff take the next
// one, find or add the bowler and type the sheet into the digital spec sheet.
// Finished sheets are in the app like any other; the app has no way into here.

import { useState, type FormEvent } from 'react';
import { Link, Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth';
import { isConfigured } from '../lib/supabase';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { useAsync } from '../lib/useAsync';
import { ADMIN_NAME, isAdminName, listIntakeNames, readWorkerName, saveWorkerName } from './api';
import { IntakeHome } from './IntakeHome';
import { AddPhotosPage } from './AddPhotosPage';
import { SheetPage } from './SheetPage';
import { AiReviewList, AiReviewPage } from './AiReviewPage';

/** Who is adding or typing in sheets; asked once on this device. */
export function useWorkerName(): [string, (name: string) => void] {
  const [name, setName] = useState(readWorkerName);
  return [
    name,
    (next) => {
      saveWorkerName(next);
      setName(next.trim());
    },
  ];
}

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const names = useAsync(listIntakeNames, []);
  // The question mark opens an unlabelled box; typing the admin name there signs in as admin.
  const [secret, setSecret] = useState<string | null>(null);
  function submitSecret(e: FormEvent) {
    e.preventDefault();
    if (secret && isAdminName(secret)) onDone(ADMIN_NAME);
    else setSecret('');
  }
  return (
    <main className="page page--narrow">
      <h1>Spec sheet intake</h1>
      <h2 className="intake-names__title">
        Who are you
        <button type="button" className="intake-names__q" aria-label="More" onClick={() => setSecret(secret === null ? '' : null)}>
          ?
        </button>
      </h2>
      {secret !== null && (
        <form onSubmit={submitSecret}>
          <input className="intake-names__secret" aria-label="Code" value={secret} autoFocus autoComplete="off" onChange={(e) => setSecret(e.target.value)} />
        </form>
      )}
      <ErrorBanner error={names.error} onRetry={names.reload} />
      {names.loading ? (
        <Spinner />
      ) : (
        <ul className="intake-names" aria-label="Your name">
          {(names.data ?? []).map((n) => (
            <li key={n}>
              <button type="button" className="btn btn--big btn--primary" onClick={() => onDone(n)}>
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Your name is shown next to the sheets you add and type in. This device remembers it.</p>
    </main>
  );
}

function Gate() {
  const { loading, membership, membershipError } = useAuth();
  const [name, setName] = useWorkerName();
  if (!isConfigured) {
    return (
      <main className="page page--narrow">
        <Notice tone="warn">The intake page is missing its Supabase settings. See docs/SETUP.md.</Notice>
      </main>
    );
  }
  if (loading) {
    return (
      <main className="page page--narrow">
        <Spinner />
      </main>
    );
  }
  if (!membership) {
    return (
      <main className="page page--narrow">
        <h1>Spec sheet intake</h1>
        <Notice tone="warn">{membershipError ? `Couldn't check access: ${membershipError}` : 'This shop is not open on this link.'}</Notice>
      </main>
    );
  }
  if (!name) return <NamePrompt onDone={setName} />;
  return (
    <div className="app intake">
      <header className="topbar intake__bar">
        <Link to="/" className="topbar__brand">
          {membership.shop_name ?? 'Pro Shop'} <span className="topbar__sub">Spec sheet intake</span>
        </Link>
        <nav className="topbar__nav" aria-label="Intake">
          <span className="muted small">{name}</span>
          <button type="button" className="linklike" onClick={() => setName('')}>
            Not you?
          </button>
        </nav>
      </header>
      <Outlet context={name} />
    </div>
  );
}

// Hash URLs (/intake/#/sheet/<id>) so reloads work on GitHub Pages without touching the app's own routes.
const router = createHashRouter([
  {
    path: '/',
    element: <Gate />,
    children: [
      { index: true, element: <IntakeHome /> },
      { path: 'add', element: <AddPhotosPage /> },
      { path: 'sheet/:itemId', element: <SheetPage /> },
      { path: 'ai-review', element: <AiReviewList /> },
      { path: 'ai-review/:itemId', element: <AiReviewPage /> },
      {
        path: '*',
        element: (
          <main className="page">
            <h1>Page not found</h1>
            <Link to="/">Back to the queue</Link>
          </main>
        ),
      },
    ],
  },
]);

export function IntakeApp() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
