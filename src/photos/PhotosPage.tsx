import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Notice, Spinner } from '../components/ui';
import { getCustomer } from '../customers/api';
import { getCurrentFit } from '../fits/api';
import { checkPhotoFile, listPhotos, signedUrls, updatePhoto, uploadPhoto, type SpecPhoto } from './api';
import { PhotoViewer } from './PhotoViewer';

const ACCEPT = 'image/jpeg,image/png,image/webp,.heic,.heif';

export function PhotosPage() {
  const { customerId = '' } = useParams();
  const [params] = useSearchParams();
  const customer = useAsync(() => getCustomer(customerId), [customerId]);
  const photos = useAsync(() => listPhotos(customerId), [customerId]);
  const fit = useAsync(() => getCurrentFit(customerId), [customerId]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SpecPhoto | null>(null);
  const [showUpload, setShowUpload] = useState(params.get('upload') === '1');
  const [justUploaded, setJustUploaded] = useState(false);

  useEffect(() => {
    const list = photos.data ?? [];
    setSelected((s) => (s && list.find((p) => p.id === s.id)) || list[0] || null);
    signedUrls(list.map((p) => p.object_path))
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [photos.data]);

  const list = photos.data ?? [];
  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to={`/customers/${customerId}`}>← {customer.data?.name ?? 'Customer'}</Link>
      </p>
      <div className="dashboard__head">
        <h1>Original sheet photos</h1>
        {!showUpload && (
          <button type="button" className="btn btn--primary" onClick={() => setShowUpload(true)}>
            Upload sheet
          </button>
        )}
      </div>
      <p className="muted">
        Photos are kept as reference only. Uploading never creates or changes digital measurements; transcribe values with Edit
        measurements.
      </p>

      {justUploaded && <Notice tone="success">Photo uploaded.</Notice>}

      {showUpload && customer.data && (
        <UploadPanel
          shopId={customer.data.shop_id}
          customerId={customerId}
          currentRevisionId={fit.data?.revision?.id ?? null}
          currentRevisionNumber={fit.data?.revision?.revision_number ?? null}
          onCancel={() => setShowUpload(false)}
          onUploaded={(p) => {
            setShowUpload(false);
            setJustUploaded(true);
            photos.setData([p, ...list]);
            setSelected(p);
          }}
        />
      )}

      <ErrorBanner error={photos.error} onRetry={photos.reload} />
      {photos.loading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="empty">No photos yet.</p>
      ) : (
        <div className="photos">
          <ul className="photo-list" aria-label="Photos">
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" className={`photo-thumb${selected?.id === p.id ? ' photo-thumb--active' : ''}`} onClick={() => setSelected(p)}>
                  {urls[p.object_path] ? (
                    <img src={urls[p.object_path]} alt="" style={{ transform: `rotate(${p.rotation}deg)` }} loading="lazy" />
                  ) : (
                    <span className="photo-thumb__placeholder" />
                  )}
                  <span>
                    {p.caption || 'Untitled'}
                    <br />
                    <span className="muted">{formatDateTime(p.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="photo-detail">
              <PhotoViewer photo={selected} url={urls[selected.object_path]} />
              <CaptionEditor
                photo={selected}
                onSaved={(p) => {
                  photos.setData(list.map((x) => (x.id === p.id ? p : x)));
                  setSelected(p);
                }}
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function CaptionEditor({ photo, onSaved }: { photo: SpecPhoto; onSaved: (p: SpecPhoto) => void }) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => setCaption(photo.caption ?? ''), [photo]);

  async function save(changes: { caption?: string | null; rotation?: number }) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await updatePhoto(photo.id, changes));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="caption-editor no-print">
      <ErrorBanner error={error} />
      <label>
        Caption
        <input value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} />
      </label>
      <div className="form__actions">
        <button type="button" className="btn btn--small" disabled={busy || caption === (photo.caption ?? '')} onClick={() => save({ caption: caption || null })}>
          Save caption
        </button>
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => save({ rotation: (photo.rotation + 270) % 360 })}>
          Rotate left
        </button>
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => save({ rotation: (photo.rotation + 90) % 360 })}>
          Rotate right
        </button>
      </div>
    </div>
  );
}

function UploadPanel({
  shopId,
  customerId,
  currentRevisionId,
  currentRevisionNumber,
  onCancel,
  onUploaded,
}: {
  shopId: string;
  customerId: string;
  currentRevisionId: string | null;
  currentRevisionNumber: number | null;
  onCancel: () => void;
  onUploaded: (p: SpecPhoto) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [caption, setCaption] = useState('');
  const [linkRevision, setLinkRevision] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  function choose(f: File | undefined) {
    setError(null);
    if (!f) return;
    const problem = checkPhotoFile(f);
    if (problem) {
      setFileError(problem);
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFileError(null);
    setFile(f);
    setRotation(0);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const p = await uploadPhoto({
        shopId,
        customerId,
        file,
        rotation,
        caption,
        revisionId: linkRevision ? currentRevisionId : null,
      });
      onUploaded(p);
    } catch (e) {
      setError(toAppError(e));
      setUploading(false);
    }
  }

  return (
    <section className="panel upload" aria-label="Upload a sheet photo">
      <h2>Upload a sheet photo</h2>
      <p className="muted">JPEG, PNG or WebP, up to 15 MB. The original file is stored unchanged.</p>
      <div className="form__actions">
        <label className="btn">
          Choose file
          <input type="file" accept={ACCEPT} className="visually-hidden" onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        <label className="btn">
          Take photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </label>
      </div>
      <ErrorBanner error={fileError} />
      {file && previewUrl && (
        <>
          <div className="upload__preview">
            <img src={previewUrl} alt="Preview of the selected photo" style={{ transform: `rotate(${rotation}deg)` }} />
          </div>
          <div className="form__actions">
            <button type="button" className="btn btn--small" onClick={() => setRotation((r) => (r + 270) % 360)}>
              Rotate left
            </button>
            <button type="button" className="btn btn--small" onClick={() => setRotation((r) => (r + 90) % 360)}>
              Rotate right
            </button>
            <span className="muted">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
          </div>
          <div className="form">
            <label>
              Caption <span className="muted">(optional)</span>
              <input value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. 2019 paper sheet" />
            </label>
            {currentRevisionId && (
              <label className="checkbox">
                <input type="checkbox" checked={linkRevision} onChange={(e) => setLinkRevision(e.target.checked)} />
                Link to current spec revision #{currentRevisionNumber}
              </label>
            )}
          </div>
        </>
      )}
      <ErrorBanner error={error ? `${error.message} Your photo is still selected, so you can try again.` : null} />
      <div className="form__actions">
        <button type="button" className="btn btn--primary" disabled={!file || uploading} onClick={upload}>
          {uploading ? 'Uploading…' : error ? 'Retry upload' : 'Upload'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={uploading}>
          Cancel
        </button>
      </div>
    </section>
  );
}
