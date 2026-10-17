import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ErrorBanner, Notice } from '../components/ui';

export function AccountPage() {
  const { session, membership } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setDone(true);
      setPassword('');
      setConfirm('');
    }
  }

  return (
    <main className="page page--narrow">
      <h1>Account</h1>
      <p>
        Signed in as <strong>{session?.user.email}</strong>
        {membership && (
          <>
            {' '}
            · {membership.role === 'admin' ? 'Administrator' : 'Staff'} at {membership.shop_name}
          </>
        )}
      </p>
      <form className="form" onSubmit={submit}>
        <h2>Set a password</h2>
        <p className="muted">If you joined from an invite or sign-in link, set a password here to sign in with it next time.</p>
        <ErrorBanner error={error} />
        {done && <Notice tone="success">Password updated.</Notice>}
        <label>
          New password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Confirm password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </div>
      </form>
    </main>
  );
}
