import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { ErrorBanner, Notice } from '../components/ui';
import type { Customer } from '../customers/api';
import { PHOTO_KIND_LABELS, checkPhotoFile, signedUrls, updatePhoto, uploadPhoto, type PhotoKind, type SpecPhoto } from './api';
import { PhotoViewer } from './PhotoViewer';

const ACCEPT = 'image/jpeg,image/png,image/webp,.heic,.heif';

/** The old photos address now opens the Photos view on the customer page. */
export function PhotosPage() {
  const { customerId = '' } = useParams();
  const [params] = useSearchParams();
  return <Navigate replace to={`/customers/${customerId}?view=photos${params.get('upload') ? '&upload=1' : ''}`} />;
}

/** Photos of the paper spec sheet and of balls, one upload at a time. */
export function PhotosPanel({
  customer,
  revisionId,
  revisionNumber,
  photos,
  onChange,
  startUpload,
}: {
  customer: Customer;
  revisionId: string | null;
  revisionNumber: number | null;
  photos: SpecPhoto[];
  onChange: (list: SpecPhoto[]) => void;
  startUpload?: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SpecPhoto | null>(null);
  const [showUpload, setShowUpload] = useState(!!startUpload);
  const [justUploaded, setJustUploaded] = useState(false);

  useEffect(() => {
    setSelected((s) => (s && photos.find((p) => p.id === s.id)) || photos[0] || null);
    signedUrls(photos.map((p) => p.object_path))
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [photos]);

  return (
    <section className="photos-panel" aria-label="Photos">
      <div className="dashboard__head">
        <h2>Photos</h2>
        {!showUpload && (
          <button type="button" className="btn btn--primary" onClick={() => setShowUpload(true)}>
            Add a photo
          </button>
        )}
      </div>
      <p className="muted">Photos of the paper spec sheet or of balls. They never change the digital measurements.</p>

      {justUploaded && <Notice tone="success">Photo uploaded.</Notice>}

      {showUpload && (
        <UploadPanel
          shopId={customer.shop_id}
          customerId={customer.id}
          currentRevisionId={revisionId}
          currentRevisionNumber={revisionNumber}
          onCancel={() => setShowUpload(false)}
          onUploaded={(p) => {
            setShowUpload(false);
            setJustUploaded(true);
            onChange([p, ...photos]);
            setSelected(p);
          }}
        />
      )}

      {photos.length === 0 ? (
        <p className="empty">No photos yet.</p>
      ) : (
        <div className="photos">
          <ul className="photo-list" aria-label="Photo list">
            {photos.map((p) => (
              <li key={p.id}>
                <button type="button" className={`photo-thumb${selected?.id === p.id ? ' photo-thumb--active' : ''}`} onClick={() => setSelected(p)}>
                  {urls[p.object_path] ? (
                    <img src={urls[p.object_path]} alt="" style={{ transform: `rotate(${p.rotation}deg)` }} loading="lazy" />
                  ) : (
                    <span className="photo-thumb__placeholder" />
                  )}
                  <span>
                    <span className="tag">{PHOTO_KIND_LABELS[p.kind]}</span>
                    {p.confirmed && <span className="tag tag--ok">Confirmed</span>}
                    <br />
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
                  onChange(photos.map((x) => (x.id === p.id ? p : x)));
                  setSelected(p);
                }}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CaptionEditor({ photo, onSaved }: { photo: SpecPhoto; onSaved: (p: SpecPhoto) => void }) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => setCaption(photo.caption ?? ''), [photo]);

  async function save(changes: { caption?: string | null; rotation?: number; confirmed?: boolean }) {
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
      {photo.kind === 'spec_sheet' && (
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={photo.confirmed}
            disabled={busy}
            onChange={(e) => save({ confirmed: e.target.checked })}
          />
          <span className="switch__track" aria-hidden="true" />
          <span>
            Digital spec sheet confirmed
            {photo.confirmed && photo.confirmed_at && (
              <span className="muted small">
                {' '}
                · {formatDateTime(photo.confirmed_at)}
                {photo.confirmed_by ? ` by ${photo.confirmed_by}` : ''}
              </span>
            )}
          </span>
        </label>
      )}
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
  const [kind, setKind] = useState<PhotoKind | ''>('');
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
    if (!file || !kind) return;
    setUploading(true);
    setError(null);
    try {
      const p = await uploadPhoto({
        shopId,
        customerId,
        file,
        rotation,
        caption,
        kind,
        revisionId: linkRevision ? currentRevisionId : null,
      });
      onUploaded(p);
    } catch (e) {
      setError(toAppError(e));
      setUploading(false);
    }
  }

  return (
    <section className="panel upload" aria-label="Add a photo">
      <h2>Add a photo</h2>
      <p className="muted">One photo at a time. JPEG, PNG or WebP, up to 15 MB. The original file is stored unchanged.</p>
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
            <fieldset className="field" aria-required="true">
              <legend className="field__label">Is this a spec sheet or a picture of a ball?</legend>
              <div className="segmented">
                {(Object.entries(PHOTO_KIND_LABELS) as Array<[PhotoKind, string]>).map(([v, label]) => (
                  <label key={v}>
                    <input type="radio" name="photo-kind" value={v} checked={kind === v} onChange={() => setKind(v)} />
                    {v === 'ball' ? 'Picture of a ball' : label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Caption <span className="muted">(optional)</span>
              <input value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} placeholder={kind === 'ball' ? 'e.g. Phaze II, 15 lb' : 'e.g. 2019 paper sheet'} />
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
        <button type="button" className="btn btn--primary" disabled={!file || !kind || uploading} onClick={upload}>
          {uploading ? 'Uploading…' : error ? 'Retry upload' : 'Upload'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={uploading}>
          Cancel
        </button>
      </div>
    </section>
  );
}
