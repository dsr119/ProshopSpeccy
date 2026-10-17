import { useState, type FormEvent } from 'react';
import { useAuth, useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { listStaff, setStaff, type StaffRow } from './api';

export function StaffPage() {
  const { shop_id, role } = useMembership();
  const { reloadMembership } = useAuth();
  const staff = useAsync(() => listStaff(shop_id), [shop_id]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [newRole, setNewRole] = useState<'staff' | 'admin'>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (role !== 'admin') {
    return (
      <main className="page">
        <h1>Staff</h1>
        <p>Only shop administrators can manage staff.</p>
      </main>
    );
  }

  async function change(row: { email: string; role: string; active: boolean; display_name: string }) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await setStaff(shop_id, row.email, row.role, row.active, row.display_name);
      setMessage(`Updated ${row.email}.`);
      staff.reload();
      reloadMembership();
      return true;
    } catch (e) {
      setError(toAppError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await change({ email, role: newRole, active: true, display_name: name })) {
      setEmail('');
      setName('');
    }
  }

  return (
    <main className="page">
      <h1>Staff</h1>
      <p className="muted">
        Only people listed here as active can see customer records. To add someone, first invite their email in the Supabase
        dashboard (Authentication › Users › Invite user), then add them below.
      </p>
      <ErrorBanner error={error} />
      {message && <Notice tone="success">{message}</Notice>}
      {staff.loading ? (
        <Spinner />
      ) : (
        <table className="staff">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Access</th>
            </tr>
          </thead>
          <tbody>
            {(staff.data ?? []).map((s: StaffRow) => (
              <tr key={s.user_id} className={s.active ? undefined : 'muted'}>
                <td>{s.display_name ?? '—'}</td>
                <td>{s.email}</td>
                <td>
                  <select
                    aria-label={`Role for ${s.email}`}
                    value={s.role}
                    disabled={busy}
                    onChange={(e) => change({ email: s.email ?? '', role: e.target.value, active: s.active, display_name: s.display_name ?? '' })}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() => change({ email: s.email ?? '', role: s.role, active: !s.active, display_name: s.display_name ?? '' })}
                  >
                    {s.active ? 'Remove access' : 'Restore access'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="form panel" onSubmit={add}>
        <h2>Add staff member</h2>
        <label>
          Email (must already be invited)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown in history" />
        </label>
        <label>
          Role
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'staff' | 'admin')}>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy}>
            Add
          </button>
        </div>
      </form>
    </main>
  );
}
