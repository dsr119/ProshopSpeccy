import { useState } from 'react';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, Spinner } from '../components/ui';

export interface PaperSide {
  /** Changes when the picture changes; the link is fetched again then. */
  key: string;
  label: string;
  load: () => Promise<string>;
}

/** A paper spec sheet, zoomable and turnable, kept in view while typing; front and back when it has both. */
export function PaperPhoto({ sides, rotation = 0 }: { sides: PaperSide[]; rotation?: number }) {
  const [index, setIndex] = useState(0);
  const side = sides[Math.min(index, sides.length - 1)];
  const url = useAsync(() => side.load(), [side.key]);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(rotation);
  return (
    <aside className="intake-photo" aria-label="Paper spec sheet">
      <div className="intake-photo__tools">
        {sides.length > 1 && (
          <div className="intake-photo__sides" role="group" aria-label="Side">
            {sides.map((s, i) => (
              <button key={s.key} type="button" className="btn btn--small" aria-pressed={side === s} onClick={() => setIndex(i)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn--small" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
          −
        </button>
        <button type="button" className="btn btn--small" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>
          +
        </button>
        <button type="button" className="btn btn--small" onClick={() => setTurn((t) => (t + 90) % 360)}>
          Turn
        </button>
        {url.data && (
          <a className="btn btn--small" href={url.data} target="_blank" rel="noreferrer">
            Full size
          </a>
        )}
      </div>
      <div className="intake-photo__frame">
        {url.error ? (
          <ErrorBanner error={url.error} onRetry={url.reload} />
        ) : url.data ? (
          <img
            src={url.data}
            alt="Paper spec sheet"
            style={{ width: `${zoom * 100}%`, transform: turn ? `rotate(${turn}deg)` : undefined }}
          />
        ) : (
          <Spinner />
        )}
      </div>
    </aside>
  );
}
