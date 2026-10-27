import { Link, NavLink, Outlet, RouterProvider, createBrowserRouter, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { Notice, Spinner } from './components/ui';
import { LoginPage } from './LoginPage';
import { DashboardPage } from './customers/DashboardPage';
import { NewCustomerPage } from './customers/NewCustomerPage';
import { CustomerPage } from './customers/CustomerPage';
import { EditFitPage } from './fits/EditFitPage';
import { HistoryPage, RevisionPage } from './fits/HistoryPage';
import { PhotosPage } from './photos/PhotosPage';
import { ImportSpecsPage } from './photos/ImportSpecsPage';
import { PrintPage } from './fits/PrintPage';
import { StaffPage } from './staff/StaffPage';
import { AccountPage } from './staff/AccountPage';
import { BallFinderPage } from './finder/BallFinderPage';

function Gate() {
  const { loading, session, membership, membershipError, signOut } = useAuth();
  if (!isConfigured) {
    return (
      <main className="page page--narrow">
        <h1>Setup needed</h1>
        <p>
          The app is missing its Supabase settings. Copy <code>.env.example</code> to <code>.env.local</code>, fill in{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, and restart. See docs/SETUP.md.
        </p>
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
  if (!session && !membership) return <LoginPage />;
  if (!membership) {
    return (
      <main className="page page--narrow">
        <h1>No shop access</h1>
        {membershipError ? (
          <Notice tone="warn">Couldn't check your access: {membershipError}</Notice>
        ) : (
          <p>
            You're signed in as <strong>{session?.user.email}</strong>, but this account isn't an active member of a shop. Ask a
            shop administrator to add you.
          </p>
        )}
        <button type="button" className="btn" onClick={() => signOut()}>
          Sign out
        </button>
      </main>
    );
  }
  return <Layout />;
}

function Layout() {
  const { membership, signOut, session } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="topbar no-print">
        <Link to="/" className="topbar__brand">
          {membership?.shop_name ?? 'Pro Shop'} <span className="topbar__sub">Spec sheets</span>
        </Link>
        <nav className="topbar__nav" aria-label="Main">
          <NavLink to="/" end>
            Customers
          </NavLink>
          {membership?.role === 'admin' && <NavLink to="/staff">Staff</NavLink>}
          {session && (
            <>
              <NavLink to="/account" title={session.user.email}>
                Account
              </NavLink>
              <button
                type="button"
                className="linklike"
                onClick={async () => {
                  await signOut();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </>
          )}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Gate />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'customers/new', element: <NewCustomerPage /> },
        { path: 'customers/:customerId', element: <CustomerPage /> },
        { path: 'customers/:customerId/edit', element: <EditFitPage /> },
        { path: 'customers/:customerId/history', element: <HistoryPage /> },
        { path: 'customers/:customerId/history/:revisionId', element: <RevisionPage /> },
        { path: 'customers/:customerId/photos', element: <PhotosPage /> },
        { path: 'customers/:customerId/photos/:photoId/import', element: <ImportSpecsPage /> },
        { path: 'customers/:customerId/print', element: <PrintPage /> },
        { path: 'find-owner', element: <BallFinderPage /> },
        { path: 'staff', element: <StaffPage /> },
        { path: 'account', element: <AccountPage /> },
        {
          path: '*',
          element: (
            <main className="page">
              <h1>Page not found</h1>
              <Link to="/">Back to customers</Link>
            </main>
          ),
        },
      ],
    },
  ],
  // Matches Vite's base so the app also works from a subfolder (GitHub Pages).
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
