import { Link, useParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { draftsEqual, snapshotToDraft } from '../measurements/schema';
import { SheetTable, SpecSheet, displayFromSnapshot } from '../template/SpecSheet';
import { getCustomer } from '../customers/api';
import { FitIdentity, FitNotes } from '../customers/CustomerPage';
import { getCurrentFit } from './api';
import { readStoredDraft } from './EditFitPage';

export function PrintPage() {
  const { customerId = '' } = useParams();
  const { userId, shop_name } = useMembership();
  const data = useAsync(async () => {
    const [customer, fit] = await Promise.all([getCustomer(customerId), getCurrentFit(customerId)]);
    return { customer, fit };
  }, [customerId]);

  if (data.loading) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }
  if (!data.data) {
    return (
      <main className="page">
        <ErrorBanner error={data.error} onRetry={data.reload} />
      </main>
    );
  }

  const { customer, fit } = data.data;
  const revision = fit.revision;
  const snapshot = revision?.snapshot ?? null;
  const stored = readStoredDraft(userId, customerId);
  const hasUnsaved = !!stored && !draftsEqual(stored.draft, snapshotToDraft(snapshot));

  return (
    <main className="page print-page">
      <div className="no-print print-toolbar">
        <Link to={`/customers/${customerId}`}>← Back</Link>
        <button type="button" className="btn btn--primary" onClick={() => window.print()} disabled={!revision}>
          Print
        </button>
      </div>
      {hasUnsaved && (
        <div className="no-print">
          <Notice tone="warn">
            You have unsaved edits for this customer. Printing uses the last saved values.{' '}
            <Link to={`/customers/${customerId}/edit`}>Go back and save first</Link>
          </Notice>
        </div>
      )}
      {!revision ? (
        <p className="empty">This customer has no saved digital specs to print.</p>
      ) : (
        <article className="print-sheet">
          <header className="print-sheet__head">
            <div>
              <h1>{customer.name}</h1>
              {customer.phone && <p>{customer.phone}</p>}
              <FitIdentity snapshot={snapshot} />
            </div>
            <div className="print-sheet__meta">
              <p>{shop_name}</p>
              <p>
                Revision #{revision.revision_number} · saved {formatDateTime(revision.created_at)}
              </p>
              <p>by {revision.author_name ?? 'unknown'}</p>
              <p>Printed {formatDateTime(new Date().toISOString())}</p>
            </div>
          </header>
          <div className="print-sheet__body">
            <SpecSheet display={displayFromSnapshot(snapshot)} />
            <FitNotes snapshot={snapshot} />
          </div>
          <SheetTable snapshot={snapshot} />
        </article>
      )}
    </main>
  );
}
