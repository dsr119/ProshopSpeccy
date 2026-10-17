import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { Dialog, ErrorBanner, Notice, Spinner } from '../components/ui';
import {
  FIELDS,
  GROUP_LABELS,
  draftToSnapshot,
  draftsEqual,
  isPitchKind,
  snapshotToDraft,
  validateDraft,
  type Draft,
  type DraftErrors,
  type FieldDef,
  type FieldGroup,
  type FieldKey,
} from '../measurements/schema';
import { SpecSheet, displayFromDraft } from '../template/SpecSheet';
import { getCustomer, type Customer } from '../customers/api';
import { getCurrentFit, parseConflict, saveFit, type ConflictInfo, type CurrentFit } from './api';
import { ChangeTable } from './HistoryPage';

interface StoredDraft {
  draft: Draft;
  baseLock: number;
  changeNote: string;
  savedAt: string;
}

const draftKey = (userId: string, customerId: string) => `proshop:draft:${userId}:${customerId}`;

export function readStoredDraft(userId: string, customerId: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(userId, customerId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

const EDIT_GROUPS: FieldGroup[] = ['identity', 'middle', 'ring', 'spans', 'thumb', 'details'];

export function EditFitPage() {
  const { customerId = '' } = useParams();
  const { userId } = useMembership();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [base, setBase] = useState<CurrentFit | null>(null);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseDraft, setBaseDraft] = useState<Draft | null>(null);
  const [expectedLock, setExpectedLock] = useState(0);
  const [changeNote, setChangeNote] = useState('');
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<AppError | null>(null);
  const [conflict, setConflict] = useState<{ info: ConflictInfo | null; latest: CurrentFit | null } | null>(null);
  const [activeField, setActiveField] = useState<FieldKey | null>(null);
  const leaving = useRef(false);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c, f] = await Promise.all([getCustomer(customerId), getCurrentFit(customerId)]);
      setCustomer(c);
      setBase(f);
      const saved = snapshotToDraft(f.revision?.snapshot ?? null);
      setBaseDraft(saved);
      const stored = readStoredDraft(userId, customerId);
      if (stored) {
        // Unsaved work from before a session expiry or reload. Keep the lock
        // version it started from so a save in between still shows a conflict.
        setDraft(stored.draft);
        setExpectedLock(stored.baseLock);
        setChangeNote(stored.changeNote);
        setRestoredDraft(!draftsEqual(stored.draft, saved));
      } else {
        setDraft(saved);
        setExpectedLock(f.fit?.lock_version ?? 0);
      }
    } catch (e) {
      setLoadError(toAppError(e));
    }
  }, [customerId, userId]);

  useEffect(() => {
    if (loadedFor.current === customerId) return;
    loadedFor.current = customerId;
    load();
  }, [customerId, load]);

  const errors: DraftErrors = useMemo(() => (draft ? validateDraft(draft) : {}), [draft]);
  const dirty = !!draft && !!baseDraft && (!draftsEqual(draft, baseDraft) || restoredDraft);

  // Keep unsaved work in this tab so a network drop, reload or expired session doesn't lose it.
  useEffect(() => {
    if (!draft || !baseDraft) return;
    const key = draftKey(userId, customerId);
    try {
      if (draftsEqual(draft, baseDraft) && !changeNote) sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({ draft, baseLock: expectedLock, changeNote, savedAt: new Date().toISOString() } satisfies StoredDraft),
        );
    } catch {
      // Storage full or unavailable; the in-memory draft is still kept.
    }
  }, [draft, baseDraft, expectedLock, changeNote, userId, customerId]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);

  function setField(key: FieldKey, patch: Partial<{ text: string; dir: string }>) {
    setDraft((d) => (d ? { ...d, [key]: { ...d[key], ...patch } } : d));
  }

  function focusField(key: FieldKey) {
    const el = document.getElementById(`field-${key}`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }
    setActiveField(key);
  }

  function discardStoredDraft() {
    try {
      sessionStorage.removeItem(draftKey(userId, customerId));
    } catch {
      // ignore
    }
  }

  function leave(to: string) {
    leaving.current = true;
    discardStoredDraft();
    navigate(to);
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!draft || saving) return;
    setShowErrors(true);
    const firstError = FIELDS.find((f) => errors[f.key]);
    if (firstError) {
      focusField(firstError.key);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveFit(customerId, expectedLock, draftToSnapshot(draft), changeNote);
      leave(`/customers/${customerId}${result.created ? '' : '?nochange=1'}`);
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.kind === 'conflict') {
        const latest = await getCurrentFit(customerId).catch(() => null);
        setConflict({ info: parseConflict(appErr), latest });
      } else {
        setSaveError(appErr);
      }
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <main className="page">
        <p className="breadcrumb">
          <Link to={`/customers/${customerId}`}>← Back</Link>
        </p>
        <ErrorBanner error={loadError} onRetry={load} />
      </main>
    );
  }
  if (!draft || !customer || !base) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }

  const noThumb = draft.thumb_mode.text === 'no_thumb';
  const visibleErrors = showErrors ? errors : Object.fromEntries(Object.entries(errors).filter(([k]) => draft[k as FieldKey].text.trim() !== ''));

  return (
    <main className="page page--wide">
      <p className="breadcrumb no-print">
        <Link to={`/customers/${customerId}`}>← {customer.name}</Link>
      </p>
      <h1>
        {base.revision ? 'Edit measurements' : 'Create digital specs'} <span className="muted">· {customer.name}</span>
      </h1>
      {base.revision && (
        <p className="muted">
          Editing from revision #{base.revision.revision_number}, saved {formatDateTime(base.revision.created_at)} by{' '}
          {base.revision.author_name ?? 'unknown'}.
        </p>
      )}
      {restoredDraft && (
        <Notice tone="warn">
          Your unsaved changes from earlier in this tab were restored.{' '}
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setDraft(baseDraft);
              setChangeNote('');
              setExpectedLock(base.fit?.lock_version ?? 0);
              setRestoredDraft(false);
            }}
          >
            Discard them
          </button>
        </Notice>
      )}

      <form className="editor" onSubmit={save} noValidate>
        <div className="editor__sheet">
          <SpecSheet
            display={displayFromDraft(draft, visibleErrors)}
            onSelectField={focusField}
            activeField={activeField}
            caption="Spec sheet preview. Select a value to jump to its field."
          />
          <p className="muted small">Select a box on the sheet to jump to its field. The preview shows unsaved values.</p>
        </div>

        <div className="editor__form">
          {EDIT_GROUPS.map((group) => (
            <fieldset key={group} className="fieldset">
              <legend>{GROUP_LABELS[group]}</legend>
              {noThumb && (group === 'thumb' || group === 'spans') && (
                <p className="banner banner--info small">
                  Not applicable in no-thumb mode. Any values here are kept in the saved record and history, and show again if you
                  switch back to thumb-in.
                </p>
              )}
              {FIELDS.filter((f) => f.group === group).map((f) => (
                <FieldControl
                  key={f.key}
                  def={f}
                  value={draft[f.key]}
                  error={visibleErrors[f.key]}
                  onChange={(patch) => setField(f.key, patch)}
                  onFocus={() => setActiveField(f.key)}
                />
              ))}
            </fieldset>
          ))}

          <fieldset className="fieldset">
            <legend>Save</legend>
            <label>
              Change note <span className="muted">(optional)</span>
              <input value={changeNote} maxLength={500} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Opened ring span 1/16" />
            </label>
            {showErrors && Object.keys(errors).length > 0 && (
              <p className="field-error" role="alert">
                Fix {Object.keys(errors).length} highlighted value{Object.keys(errors).length > 1 ? 's' : ''} before saving. Nothing you
                typed was removed.
              </p>
            )}
            <ErrorBanner
              error={saveError ? `${saveError.message} Your changes are still here.` : null}
              onRetry={saveError?.kind === 'session' ? undefined : () => save()}
            />
          </fieldset>
        </div>

        <div className="editor__bar">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => (dirty ? navigate(`/customers/${customerId}`) : leave(`/customers/${customerId}`))}
          >
            Cancel
          </button>
          <span className="muted small">{dirty ? 'Unsaved changes' : 'No changes yet'}</span>
        </div>
      </form>

      <Dialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        onClose={() => blocker.reset?.()}
        actions={
          <>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                discardStoredDraft();
                blocker.proceed?.();
              }}
            >
              Discard changes
            </button>
            <button type="button" className="btn btn--primary" onClick={() => blocker.reset?.()}>
              Keep editing
            </button>
          </>
        }
      >
        <p>Your measurement changes have not been saved. The last saved version will stay as it is.</p>
      </Dialog>

      {conflict && (
        <Dialog
          open
          wide
          title="Someone else saved this fit"
          onClose={() => setConflict(null)}
          actions={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const latest = conflict.latest;
                  if (latest) {
                    const saved = snapshotToDraft(latest.revision?.snapshot ?? null);
                    setBase(latest);
                    setBaseDraft(saved);
                    setDraft(saved);
                    setExpectedLock(latest.fit?.lock_version ?? 0);
                    setRestoredDraft(false);
                  }
                  setConflict(null);
                }}
                disabled={!conflict.latest}
              >
                Discard mine and load theirs
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // Keep my values but edit on top of the latest version; the next Save is an explicit choice.
                  const latest = conflict.latest;
                  if (latest) {
                    setBase(latest);
                    setBaseDraft(snapshotToDraft(latest.revision?.snapshot ?? null));
                    setExpectedLock(latest.fit?.lock_version ?? 0);
                  }
                  setConflict(null);
                }}
                disabled={!conflict.latest}
              >
                Keep my changes and review
              </button>
            </>
          }
        >
          <p>
            {conflict.info?.author_name ?? 'Another staff member'} saved revision #{conflict.info?.revision_number ?? '?'}
            {conflict.info?.created_at ? ` at ${formatDateTime(conflict.info.created_at)}` : ''} while you were editing. Your
            changes have not been saved and nothing was overwritten.
          </p>
          <h3>Their saved values compared with yours</h3>
          {conflict.latest ? (
            <ChangeTable
              before={conflict.latest.revision?.snapshot ?? null}
              after={safeSnapshot(draft)}
              beforeLabel="Their saved version"
              afterLabel="Your unsaved version"
            />
          ) : (
            <p className="muted">Couldn't load their version. Check the connection and reload.</p>
          )}
          <p className="small muted">
            Choosing “Keep my changes and review” keeps your values on screen. Saving after that creates a new revision on top of
            theirs, and theirs stays in History.
          </p>
        </Dialog>
      )}
    </main>
  );
}

function safeSnapshot(draft: Draft) {
  try {
    return draftToSnapshot(draft);
  } catch {
    return null;
  }
}

const DIR_OPTIONS: Record<'pitch_lateral' | 'pitch_fr', Array<[string, string]>> = {
  pitch_lateral: [
    ['', 'Direction…'],
    ['left', 'Left'],
    ['right', 'Right'],
    ['none', 'Neutral (zero)'],
  ],
  pitch_fr: [
    ['', 'Direction…'],
    ['forward', 'Forward'],
    ['reverse', 'Reverse'],
    ['none', 'Neutral (zero)'],
  ],
};

function FieldControl({
  def,
  value,
  error,
  onChange,
  onFocus,
}: {
  def: FieldDef;
  value: { text: string; dir: string };
  error?: string;
  onChange: (patch: Partial<{ text: string; dir: string }>) => void;
  onFocus: () => void;
}) {
  const id = `field-${def.key}`;
  const errId = `${id}-error`;
  const describedBy = error ? errId : undefined;

  if (def.kind === 'enum_hand' || def.kind === 'enum_thumb_mode') {
    const options =
      def.kind === 'enum_hand'
        ? [
            ['right', 'Right-handed'],
            ['left', 'Left-handed'],
            ['', 'Not recorded'],
          ]
        : [
            ['thumb_in', 'Thumb-in'],
            ['no_thumb', 'No-thumb'],
            ['', 'Not recorded'],
          ];
    return (
      <div className="field" role="radiogroup" aria-labelledby={`${id}-label`}>
        <span id={`${id}-label`} className="field__label">
          {def.label}
        </span>
        <div className="segmented">
          {options.map(([v, label], i) => (
            <label key={v || 'none'}>
              <input
                type="radio"
                id={i === 0 ? id : undefined}
                name={def.key}
                value={v}
                checked={value.text === v}
                onChange={() => onChange({ text: v })}
                onFocus={onFocus}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (def.kind === 'text_long') {
    return (
      <label className="field">
        <span className="field__label">{def.label}</span>
        <textarea id={id} rows={3} value={value.text} onChange={(e) => onChange({ text: e.target.value })} onFocus={onFocus} aria-invalid={!!error} aria-describedby={describedBy} />
        {error && <span id={errId} className="field-error">{error}</span>}
      </label>
    );
  }

  const unit = def.unit === '°' ? 'degrees' : def.unit === 'in' ? 'inches' : null;
  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={id} className="field__label">
        {def.label}
        {unit && <span className="muted"> ({unit})</span>}
      </label>
      <div className="field__row">
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={value.text}
          placeholder={def.kind === 'text_short' ? '' : def.kind === 'angle' ? 'e.g. 15' : 'e.g. 4 3/8'}
          onChange={(e) => onChange({ text: e.target.value })}
          onFocus={onFocus}
          aria-invalid={!!error}
          aria-describedby={describedBy}
        />
        {isPitchKind(def.kind) && (
          <select
            aria-label={`${def.label} direction`}
            value={value.dir}
            onChange={(e) => onChange({ dir: e.target.value })}
            onFocus={onFocus}
          >
            {DIR_OPTIONS[def.kind as 'pitch_lateral' | 'pitch_fr'].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && (
        <span id={errId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
