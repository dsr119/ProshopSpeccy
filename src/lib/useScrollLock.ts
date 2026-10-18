import { useEffect } from 'react';

let locks = 0;
let savedY = 0;

/**
 * Keeps the page behind a picker or dialog from scrolling while it is open.
 * The body is pinned in place (iPhone Safari ignores overflow: hidden alone)
 * and put back at the same scroll position afterwards.
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (locks++ === 0) {
      savedY = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `-${savedY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0) {
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.overflow = '';
        window.scrollTo(0, savedY);
      }
    };
  }, [active]);
}
