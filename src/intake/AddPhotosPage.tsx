import { useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError } from '../lib/errors';
import { formatBytes } from '../lib/shrinkPhoto';
import { addBack, addToQueue, type IntakeItem } from './api';

interface Upload {
  key: string;
  name: string;
  state: 'sending' | 'queued' | 'failed';
  error?: string;
  file: File;
  item?: IntakeItem;
  back?: 'sending' | 'added' | 'failed';
  backError?: string;
}

/** Take photos of paper sheets (or pick several from the library); each one goes into the queue, with its back if needed. */
export function AddPhotosPage() {
  const name = useOutletContext<string>();
  const { shop_id } = useMembership();
  const [uploads, setUploads] = useState<Upload[]>([]);
  // The sheet a back photo is being taken for, and the sheet just photographed with the camera.
  const [backFor, setBackFor] = useState<string | null>(null);
  const [lastCamera, setLastCamera] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const backCamera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());

  const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const find = (key: string) => new Promise<Upload | undefined>((resolve) => setUploads((u) => (resolve(u.find((x) => x.key === key)), u)));

  // One at a time, in the order they were taken, so a weak connection isn't swamped.
  const inTurn = (job: () => Promise<void>) => (queue.current = queue.current.then(job));

  function send(up: Upload) {
    inTurn(async () => {
      set(up.key, { state: 'sending', error: undefined });
      try {
        set(up.key, { state: 'queued', item: await addToQueue(shop_id, up.file, name) });
      } catch (e) {
        set(up.key, { state: 'failed', error: toAppError(e).message });
      }
    });
  }

  function sendBack(key: string, file: File) {
    set(key, { back: 'sending', backError: undefined });
    inTurn(async () => {
      const up = await find(key);
      if (!up?.item) {
        set(key, { back: 'failed', backError: "The front didn't send yet. Try the front again first." });
        return;
      }
      try {
        set(key, { back: 'added', item: await addBack(up.item, file) });
      } catch (e) {
        set(key, { back: 'failed', backError: toAppError(e).message });
      }
    });
  }

  function add(files: FileList | null, fromCamera: boolean) {
    const next = Array.from(files ?? []).map((file) => ({
      key: crypto.randomUUID(),
      name: file.name,
      state: 'sending' as const,
      file,
    }));
    setUploads((u) => [...next, ...u]);
    next.forEach(send);
    setLastCamera(fromCamera && next.length ? next[0].key : null);
  }

  function takeBack(key: string) {
    setBackFor(key);
    backCamera.current?.click();
  }

  const queued = uploads.filter((u) => u.state === 'queued').length;
  const backs = uploads.filter((u) => u.back === 'added').length;
  const sending = uploads.filter((u) => u.state === 'sending' || u.back === 'sending').length;
  const failed = uploads.filter((u) => u.state === 'failed' || u.back === 'failed').length;
  const last = uploads.find((u) => u.key === lastCamera);

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/">← Queue</Link>
      </p>
      <h1>Take photos of sheets</h1>
      <p className="muted">
        One paper sheet per photo, flat and filling the frame. If something is written on the back, add a photo of the back
        too. Photos are made smaller before they're sent, and each sheet goes straight into the queue.
      </p>

      {last && !last.back ? (
        <div className="intake-next" role="group" aria-label="Sheet just taken">
          <p>
            <strong>Got the front.</strong> Is anything written on the back?
          </p>
          <div className="intake-actions">
            <button type="button" className="btn btn--big" onClick={() => takeBack(last.key)}>
              Take the back
            </button>
            <button type="button" className="btn btn--primary btn--big" onClick={() => camera.current?.click()}>
              Next sheet
            </button>
          </div>
        </div>
      ) : (
        <div className="intake-actions">
          <button type="button" className="btn btn--primary btn--big" onClick={() => camera.current?.click()}>
            {uploads.length ? 'Next sheet' : 'Take a photo'}
          </button>
          <button type="button" className="btn btn--big" onClick={() => library.current?.click()}>
            Choose photos
          </button>
        </div>
      )}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="camera-input"
        onChange={(e) => {
          add(e.target.files, true);
          e.target.value = '';
        }}
      />
      <input
        ref={backCamera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="back-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && backFor) sendBack(backFor, file);
          e.target.value = '';
        }}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="library-input"
        onChange={(e) => {
          add(e.target.files, false);
          e.target.value = '';
        }}
      />

      {uploads.length > 0 && (
        <p className="intake-progress" role="status">
          {queued} {queued === 1 ? 'sheet' : 'sheets'} added to the queue
          {backs ? ` (${backs} with a back)` : ''}
          {sending ? `, ${sending} sending` : ''}
          {failed ? `, ${failed} didn't send` : ''}
        </p>
      )}
      <ul className="intake-uploads">
        {uploads.map((u) => (
          <li key={u.key} data-state={u.state}>
            <span>
              {u.name}
              {u.item && <span className="muted small"> · {formatBytes(u.item.size_bytes)}</span>}
            </span>
            {u.state === 'sending' && <span className="muted small">Sending…</span>}
            {u.state === 'queued' && (
              <span className="intake-uploads__done">
                <span className="tag tag--ok">{u.back === 'added' ? 'Front and back in the queue' : 'In the queue'}</span>
                {u.back === 'sending' && <span className="muted small">Sending the back…</span>}
                {u.back !== 'added' && u.back !== 'sending' && (
                  <button type="button" className="btn btn--small" onClick={() => takeBack(u.key)}>
                    Add the back
                  </button>
                )}
                {u.back === 'failed' && <span className="field-error">{u.backError}</span>}
              </span>
            )}
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
