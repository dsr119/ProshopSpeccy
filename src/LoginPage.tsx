import { useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';
import { useAuth } from './lib/auth';
import { ErrorBanner, Notice } from './components/ui';

export function LoginPage() {
  const { sessionExpired } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password did not match.' : error.message);
  }

  async function sendLink() {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setBusy(true);
    setError(null);
    // shouldCreateUser: false keeps sign-in invite-only.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setLinkSent(true);
  }

  return (
    <main className="page page--narrow login">
      <h1>Pro Shop Spec Sheets</h1>
      <p className="muted">Staff sign-in. Accounts are by invitation only.</p>
      {sessionExpired && <Notice tone="warn">Your session expired. Sign in again to continue where you left off.</Notice>}
      {linkSent && <Notice tone="success">If that email belongs to a staff account, a sign-in link is on its way.</Notice>}
      <ErrorBanner error={error} />
      <form onSubmit={signIn} className="form">
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={sendLink}>
            Email me a sign-in link
          </button>
        </div>
      </form>
    </main>
  );
}
