import { useEffect, useRef, type ReactNode } from 'react';
import type { AppError } from '../lib/errors';
import { useScrollLock } from '../lib/useScrollLock';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </p>
  );
}

export function ErrorBanner({ error, onRetry }: { error: AppError | string | null; onRetry?: () => void }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  return (
    <div className="banner banner--error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'success' }) {
  return (
    <div className={`banner banner--${tone}`} role="status">
      {children}
    </div>
  );
}

interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions: ReactNode;
  wide?: boolean;
}

export function Dialog({ open, title, children, onClose, actions, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useScrollLock(open);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <h2 id="dialog-title">{title}</h2>
      <div className="dialog__body">{children}</div>
      <div className="dialog__actions">{actions}</div>
    </dialog>
  );
}
