// Turns Supabase/PostgREST/network errors into messages staff can act on.

export type ErrorKind = 'network' | 'session' | 'conflict' | 'validation' | 'forbidden' | 'not_found' | 'unknown';

export class AppError extends Error {
  kind: ErrorKind;
  detail?: string;
  constructor(kind: ErrorKind, message: string, detail?: string) {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

interface MaybePgError {
  message?: string;
  code?: string;
  details?: string | null;
  status?: number;
  name?: string;
}

let onSessionError: (() => void) | null = null;
export function setSessionErrorHandler(fn: (() => void) | null) {
  onSessionError = fn;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (err ?? {}) as MaybePgError;
  const msg = e.message ?? String(err);
  let result: AppError;
  if (err instanceof TypeError || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
    result = new AppError('network', "Couldn't reach the server. Check the connection and try again.");
  } else if (e.code === 'PT401' || e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(msg)) {
    result = new AppError('session', 'Your session has expired. Sign in again to continue.');
  } else if (e.code === 'PT409') {
    result = new AppError('conflict', msg, e.details ?? undefined);
  } else if (e.code === 'PT422' || e.code === '23514' || e.code === '22023') {
    result = new AppError('validation', msg);
  } else if (e.code === 'PT403' || e.code === '42501' || /row-level security|permission denied|Unauthorized/i.test(msg)) {
    result = new AppError('forbidden', "You don't have access to do that. Ask a shop administrator if this seems wrong.");
  } else if (e.code === 'PT404' || e.code === 'PGRST116') {
    result = new AppError('not_found', msg === 'JSON object requested, multiple (or no) rows returned' ? 'Not found' : msg);
  } else {
    result = new AppError('unknown', msg || 'Something went wrong. Try again.');
  }
  if (result.kind === 'session') onSessionError?.();
  return result;
}

/** Unwraps a Supabase { data, error } response, throwing an AppError. */
export function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw toAppError(res.error);
  return res.data;
}
