import { useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError } from '../lib/errors';
import { addToQueue } from './api';

interface Upload {
  key: string;
  name: string;
  state: 'sending' | 'queued' | 'failed';
  error?: string;
  file: File;
}

/** Take photos of paper sheets (or pick several from the library); each one goes into the queue. */
export function AddPhotosPage() {
  const name = useOutletContext<string>();
  const { shop_id } = useMembership();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());

  const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function send(up: Upload) {
    // One at a time, in the order they were taken, so a weak connection isn't swamped.
    queue.current = queue.current.then(async () => {
      set(up.key, { state: 'sending', error: undefined });
      try {
        await addToQueue(shop_id, up.file, name);
        set(up.key, { state: 'queued' });
      } catch (e) {
        set(up.key, { state: 'failed', error: toAppError(e).message });
      }
    });
  }

  function add(files: FileList | null) {
    const next = Array.from(files ?? []).map((file) => ({
      key: crypto.randomUUID(),
      name: file.name,
      state: 'sending' as const,
      file,
    }));
    setUploads((u) => [...next, ...u]);
    next.forEach(send);
  }

  const queued = uploads.filter((u) => u.state === 'queued').length;
  const sending = uploads.filter((u) => u.state === 'sending').length;
  const failed = uploads.filter((u) => u.state === 'failed');

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/">← Queue</Link>
      </p>
      <h1>Take photos of sheets</h1>
      <p className="muted">
        One paper sheet per photo, flat and filling the frame. Each photo goes straight into the queue, so you can keep going.
      </p>
      <div className="intake-actions">
        <button type="button" className="btn btn--primary btn--big" onClick={() => camera.current?.click()}>
          Take a photo
        </button>
        <button type="button" className="btn btn--big" onClick={() => library.current?.click()}>
          Choose photos
        </button>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        data-testid="camera-input"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={library}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        data-testid="library-input"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />

      {uploads.length > 0 && (
        <p className="intake-progress" role="status">
          {queued} added to the queue{sending ? `, ${sending} sending` : ''}
          {failed.length ? `, ${failed.length} didn't send` : ''}
        </p>
      )}
      <ul className="intake-uploads">
        {uploads.map((u) => (
          <li key={u.key} data-state={u.state}>
            <span>{u.name}</span>
            {u.state === 'sending' && <span className="muted small">Sending…</span>}
            {u.state === 'queued' && <span className="tag tag--ok">In the queue</span>}
            {u.state === 'failed' && (
              <>
                <span className="field-error">{u.error}</span>
                <button type="button" className="btn btn--small" onClick={() => send(u)}>
                  Try again
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
