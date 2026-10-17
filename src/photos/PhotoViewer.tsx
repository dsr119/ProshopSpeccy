import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type { SpecPhoto } from './api';

const ZOOMS = [1, 1.5, 2, 3, 4];

/** Shows a stored photo with its saved rotation, with zoom and scroll-to-pan. */
export function PhotoViewer({ photo, url, rotationOverride }: { photo: SpecPhoto; url?: string; rotationOverride?: number }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const rotation = rotationOverride ?? photo.rotation;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setZoomIdx(0);
    setFailed(false);
    setNatural(null);
  }, [photo.id]);

  const rotated = rotation % 180 !== 0;
  const zoom = ZOOMS[zoomIdx];
  const boxW = containerW * zoom;
  const ratio = natural ? (rotated ? natural.w / natural.h : natural.h / natural.w) : 1.3;
  const boxH = boxW * ratio;
  const imgW = rotated ? boxH : boxW;
  const imgH = rotated ? boxW : boxH;

  return (
    <figure className="photo-viewer">
      <div className="photo-viewer__tools no-print">
        <button type="button" className="btn btn--small" onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0}>
          Zoom out
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))}
          disabled={zoomIdx === ZOOMS.length - 1}
        >
          Zoom in
        </button>
        {url && (
          <a className="btn btn--small" href={url} target="_blank" rel="noreferrer">
            Open full size
          </a>
        )}
      </div>
      <div className="photo-viewer__stage" ref={stageRef}>
        {!url ? (
          <p className="muted">{failed ? 'Could not load this photo.' : 'Loading photo…'}</p>
        ) : (
          <div className="photo-viewer__box" style={{ width: boxW || undefined, height: boxW ? boxH : undefined }}>
            <img
              src={url}
              alt={photo.caption ? `Original sheet: ${photo.caption}` : 'Original paper spec sheet'}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              style={{
                width: imgW || '100%',
                height: boxW ? imgH : 'auto',
                left: (boxW - imgW) / 2,
                top: (boxH - imgH) / 2,
                transform: `rotate(${rotation}deg)`,
              }}
            />
          </div>
        )}
      </div>
      <figcaption className="muted">
        {photo.caption || 'Untitled photo'} · uploaded {formatDateTime(photo.created_at)} by {photo.author_name ?? 'unknown'}
      </figcaption>
    </figure>
  );
}
