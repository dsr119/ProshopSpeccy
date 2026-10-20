import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { getCustomer } from '../customers/api';
import { getCurrentFit, getRevision } from '../fits/api';
import { EditFitPage } from '../fits/EditFitPage';
import { PaperPhoto, type PaperSide } from './PaperPhoto';
import { canImportSpecs, isSheetBack, linkedRevisionId, listPhotos, photoUrls, setCurrentPhoto, type SpecPhoto } from './api';

function photoSide(p: SpecPhoto, label: string): PaperSide {
  return { key: p.id, label, load: async () => (await photoUrls([p]))[p.object_path] ?? Promise.reject(new Error('Photo not found')) };
}

/**
 * A spec sheet photo beside the digital sheet, like the intake screen. Saving adds a new
 * digital version and makes it and this photo the bowler's current spec sheet.
 */
export function ImportSpecsPage() {
  const { customerId = '', photoId = '' } = useParams();
  const navigate = useNavigate();
  const data = useAsync(async () => {
    const [customer, photos, current] = await Promise.all([getCustomer(customerId), listPhotos(customerId), getCurrentFit(customerId)]);
    const photo = photos.find((p) => p.id === photoId) ?? null;
    // A sheet the AI read but nobody checked: start from what it read, so only the misses need fixing.
    const linked = photo ? linkedRevisionId(photo) : null;
    const startFrom =
      linked && linked !== current.fit?.current_revision_id ? (await getRevision(linked).catch(() => null))?.snapshot ?? null : null;
    // The back of the same paper, when it came in with this front.
    const back = photo?.revision_id ? photos.find((p) => p.id !== photo.id && isSheetBack(p) && p.revision_id === photo.revision_id) : undefined;
    return { customer, photo, back, startFrom };
  }, [customerId, photoId]);

  const back = <Link to={`/customers/${customerId}?view=photos&photo=${photoId}`}>← Photos</Link>;

  if (data.loading) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }
  const d = data.data;
  if (data.error || !d || !d.photo || !canImportSpecs(d.photo)) {
    return (
      <main className="page">
        <p className="breadcrumb">{back}</p>
        <ErrorBanner error={data.error ?? 'This photo is not a spec sheet, or it was deleted.'} onRetry={data.reload} />
      </main>
    );
  }

  const photo = d.photo;
  const sides = [photoSide(photo, 'Front'), ...(d.back ? [photoSide(d.back, 'Back')] : [])];

  return (
    <div className="intake-work">
      <PaperPhoto sides={sides} rotation={photo.rotation} />
      <div className="intake-work__form">
        <div className="intake-work__bar">
          <span className="breadcrumb">{back}</span>
        </div>
        <p className="intake-step">
          <strong>Import specs for {d.customer.name}</strong> from {photo.caption ? `“${photo.caption}”` : 'this paper sheet'}. Saving adds a
          new version, and it and this photo become the current spec sheet. Earlier versions stay in the history.
        </p>
        {d.startFrom && (
          <Notice>The AI already read this sheet, so its reading is filled in below. Check each value against the paper.</Notice>
        )}
        <EditFitPage
          embed={{
            customerId,
            startFrom: d.startFrom,
            saveLabel: 'Save as the current version',
            onCancel: () => navigate(`/customers/${customerId}?view=photos&photo=${photoId}`),
            onSaved: async (result) => {
              await setCurrentPhoto(photo.id, result.revision_id);
              navigate(`/customers/${customerId}?imported=1`);
            },
          }}
        />
      </div>
    </div>
  );
}
