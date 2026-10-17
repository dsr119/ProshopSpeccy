import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { ErrorBanner } from '../components/ui';
import { EMPTY_CUSTOMER, createCustomer, findPossibleDuplicates, validateCustomer, type CustomerInput, type DuplicateRow } from './api';

export function CustomerFields({
  value,
  onChange,
  errors,
}: {
  value: CustomerInput;
  onChange: (v: CustomerInput) => void;
  errors: Partial<Record<keyof CustomerInput, string>>;
}) {
  return (
    <>
      <label>
        Name <span className="req">(required)</span>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
          autoFocus
        />
        {errors.name && (
          <span id="name-error" className="field-error">
            {errors.name}
          </span>
        )}
      </label>
      <label>
        Phone <span className="muted">(optional)</span>
        <input type="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        {errors.phone && <span className="field-error">{errors.phone}</span>}
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={value.phone_mobile} onChange={(e) => onChange({ ...value, phone_mobile: e.target.checked })} />
        Mobile
      </label>
      <label>
        Email <span className="muted">(optional)</span>
        <input type="email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
        {errors.email && <span className="field-error">{errors.email}</span>}
      </label>
      <label>
        Address <span className="muted">(optional)</span>
        <input autoComplete="street-address" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
        {errors.address && <span className="field-error">{errors.address}</span>}
      </label>
      <div className="form__row">
        <label>
          City
          <input value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
          {errors.city && <span className="field-error">{errors.city}</span>}
        </label>
        <label>
          State
          <input value={value.state} onChange={(e) => onChange({ ...value, state: e.target.value })} />
          {errors.state && <span className="field-error">{errors.state}</span>}
        </label>
        <label>
          Zip code
          <input inputMode="numeric" value={value.zip} onChange={(e) => onChange({ ...value, zip: e.target.value })} />
          {errors.zip && <span className="field-error">{errors.zip}</span>}
        </label>
      </div>
      <label>
        Notes <span className="muted">(optional)</span>
        <textarea rows={3} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
        {errors.notes && <span className="field-error">{errors.notes}</span>}
      </label>
    </>
  );
}

export function NewCustomerPage() {
  const { shop_id } = useMembership();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [value, setValue] = useState<CustomerInput>({ ...EMPTY_CUSTOMER, name: params.get('name') ?? '' });
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInput, string>>>({});
  const [dupes, setDupes] = useState<DuplicateRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (value.name.trim().length < 2 && value.phone.replace(/\D/g, '').length < 7) {
      setDupes([]);
      return;
    }
    const t = setTimeout(() => {
      findPossibleDuplicates(value.name, value.phone)
        .then(setDupes)
        .catch(() => setDupes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [value.name, value.phone]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateCustomer(value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    try {
      const c = await createCustomer(shop_id, value);
      navigate(`/customers/${c.id}?created=1`, { replace: true });
    } catch (err) {
      setError(toAppError(err));
      setSaving(false);
    }
  }

  return (
    <main className="page page--narrow">
      <p className="breadcrumb">
        <Link to="/">← Customers</Link>
      </p>
      <h1>Add customer</h1>
      <ErrorBanner error={error} />
      <form className="form" onSubmit={submit} noValidate>
        <CustomerFields value={value} onChange={setValue} errors={errors} />
        {dupes.length > 0 && (
          <div className="banner banner--warn" role="status">
            <p>
              <strong>Possible existing customer{dupes.length > 1 ? 's' : ''}.</strong> Open one if it's the same person, or
              continue if this is someone different.
            </p>
            <ul className="dupes">
              {dupes.map((d) => (
                <li key={d.id}>
                  <Link to={`/customers/${d.id}`}>{d.name}</Link>
                  {d.phone && <span className="muted"> · {d.phone}</span>}
                  <span className="muted"> · {d.reason}</span>
                  {d.notes && <span className="muted"> · {d.notes.slice(0, 60)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : dupes.length ? 'Create as new customer' : 'Create customer'}
          </button>
          <Link to="/" className="btn">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
