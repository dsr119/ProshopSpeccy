// The paper spec sheet intake page, a separate page from the app (served at
// /intake/). Photos of paper sheets go into a queue; shop staff take the next
// one, find or add the bowler and type the sheet into the digital spec sheet.
// Finished sheets are in the app like any other; the app has no way into here.

import { useState } from 'react';
import { Link, Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth';
import { isConfigured } from '../lib/supabase';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { useAsync } from '../lib/useAsync';
import { ADMIN_NAME, listIntakeNames, readWorkerName, saveWorkerName } from './api';
import { IntakeHome } from './IntakeHome';
import { AddPhotosPage } from './AddPhotosPage';
import { SheetPage } from './SheetPage';

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
  return (
    <main className="page page--narrow">
      <h1>Spec sheet intake</h1>
      <h2 className="intake-names__title">Who are you?</h2>
      <ErrorBanner error={names.error} onRetry={names.reload} />
      {names.loading ? (
        <Spinner />
      ) : (
        <ul className="intake-names" aria-label="Your name">
          {[...(names.data ?? []), ADMIN_NAME].map((n) => (
            <li key={n}>
              <button type="button" className={`btn btn--big${n === ADMIN_NAME ? '' : ' btn--primary'}`} onClick={() => onDone(n)}>
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Your name is shown next to the sheets you add and type in. This device remembers it. Not on the list? Ask whoever signs in as Admin to add you.</p>
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
