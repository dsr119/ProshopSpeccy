// A phone-style picker with scroll wheels side by side (like picking a date),
// shown as a sheet at the bottom of the screen. Each wheel snaps to one item;
// the item in the middle band is the chosen one. Items can also be tapped,
// and the arrow keys move a focused wheel.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const ITEM_H = 44;
const VISIBLE = 5;

export interface WheelColumn {
  label: string;
  options: Array<{ value: string; label: string }>;
}

interface WheelPickerProps {
  title: string;
  columns: WheelColumn[];
  /** The value chosen on each wheel when the picker opens. */
  initial: string[];
  onDone: (values: string[]) => void;
  onClear: () => void;
  onClose: () => void;
  /** Headings over runs of wheels, e.g. "Horizontal" over its inches and fraction wheels. */
  groups?: Array<{ label: string; span: number }>;
  /** Extra controls under the wheels. */
  footer?: ReactNode;
}

export function WheelPicker({ title, columns, initial, onDone, onClear, onClose, groups, footer }: WheelPickerProps) {
  const [picked, setPicked] = useState(() =>
    columns.map((c, i) => Math.max(0, c.options.findIndex((o) => o.value === initial[i]))),
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="wheel-backdrop" onClick={onClose}>
      <div className={`wheel-sheet${groups ? ' wheel-sheet--grouped' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="wheel-sheet__bar">
          <button type="button" className="wheel-sheet__action" onClick={onClear}>
            Clear
          </button>
          <strong>{title}</strong>
          <button
            type="button"
            className="wheel-sheet__action wheel-sheet__action--done"
            onClick={() => onDone(picked.map((p, i) => columns[i].options[p].value))}
          >
            Done
          </button>
        </div>
        {groups && (
          <div className="wheel-sheet__groups" aria-hidden="true">
            {groups.map((g) => (
              <span key={g.label} style={{ flex: g.span }}>
                {g.label}
              </span>
            ))}
          </div>
        )}
        <div className="wheel-sheet__wheels" style={{ height: ITEM_H * VISIBLE }}>
          <div className="wheel-sheet__band" style={{ top: ITEM_H * Math.floor(VISIBLE / 2), height: ITEM_H }} aria-hidden="true" />
          {columns.map((col, i) => (
            <Wheel
              key={col.label}
              column={col}
              index={picked[i]}
              onChange={(index) => setPicked((p) => p.map((v, j) => (j === i ? index : v)))}
            />
          ))}
        </div>
        {footer}
      </div>
    </div>
  );
}

function Wheel({ column, index, onChange }: { column: WheelColumn; index: number; onChange: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const pad = ITEM_H * Math.floor(VISIBLE / 2);

  // Start on the current value without animating.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = index * ITEM_H;
    // Only on open; afterwards the wheel's own scroll position leads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scrollTo(i: number) {
    const clamped = Math.max(0, Math.min(column.options.length - 1, i));
    onChange(clamped);
    ref.current?.scrollTo({ top: clamped * ITEM_H, behavior: 'smooth' });
  }

  function onScroll() {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      if (!ref.current) return;
      const i = Math.round(ref.current.scrollTop / ITEM_H);
      if (i !== index) onChange(Math.max(0, Math.min(column.options.length - 1, i)));
    }, 80);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') scrollTo(index + 1);
    else if (e.key === 'ArrowUp') scrollTo(index - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div
      ref={ref}
      className="wheel"
      role="listbox"
      aria-label={column.label}
      aria-activedescendant={`${column.label}-${index}`}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      style={{ paddingTop: pad, paddingBottom: pad, scrollPaddingTop: pad }}
    >
      {column.options.map((o, i) => (
        <div
          key={o.value}
          id={`${column.label}-${i}`}
          role="option"
          aria-selected={i === index}
          className={`wheel__item${i === index ? ' is-on' : ''}`}
          style={{ height: ITEM_H }}
          onClick={() => scrollTo(i)}
        >
          {o.label}
        </div>
      ))}
    </div>
  );
}
