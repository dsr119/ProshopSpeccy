import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useMembership } from '../lib/auth';
import { toAppError, type AppError } from '../lib/errors';
import { formatDate, formatDateTime } from '../lib/format';
import { Dialog, ErrorBanner, Notice, Spinner } from '../components/ui';
import {
  FIELDS,
  GROUP_LABELS,
  draftToSnapshot,
  draftsEqual,
  SPAN_TYPE_HINTS,
  SPAN_TYPE_LABELS,
  THUMB_INSERT_TYPES,
  THUMB_MODE_LABELS,
  snapshotToDraft,
  GRIP_BRAND_FIELDS,
  validateDraft,
  type Draft,
  type DraftErrors,
  type FieldDef,
  type FieldKey,
  type SpanType,
} from '../measurements/schema';
import { SpecSheet, displayFromDraft } from '../template/SpecSheet';
import { getCustomer, type Customer } from '../customers/api';
import { BowlerCard } from '../customers/BowlerCard';
import { EditCustomerDialog } from '../customers/CustomerPage';
import { getCurrentFit, listSpecAuthors, parseConflict, saveFit, type ConflictInfo, type CurrentFit, type SaveResult } from './api';
import { ChangeTable } from './HistoryPage';
import { ballToDraft, ballsEqual, listBalls, saveBalls, validateBalls, type BallDraft } from '../balls/api';
import { BallsEditor } from '../balls/BallsSection';

interface StoredDraft {
  draft: Draft;
  baseLock: number;
  changeNote: string;
  savedAt: string;
  /** The bowler's balls as edited; missing in drafts kept before balls existed. */
  balls?: BallDraft[];
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

/** Measurements kept in the record but not drawn on the sheet; they're edited under "More measurements". */
const OFF_SHEET: FieldKey[] = ['middle_oval', 'ring_oval', 'middle_actual_cut', 'ring_actual_cut', 'thumb_oval', 'thumb_oval_angle'];

/** The editor used inside another page (the intake queue) instead of on its own route. */
export interface EmbeddedEditor {
  customerId: string;
  /** Runs after a save; the editor shows any error it throws and keeps the values. */
  onSaved: (result: SaveResult) => Promise<void>;
  onCancel: () => void;
  saveLabel?: string;
}

export function EditFitPage({ embed }: { embed?: EmbeddedEditor } = {}) {
  const params = useParams();
  const customerId = embed?.customerId ?? params.customerId ?? '';
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
  const [editingBowler, setEditingBowler] = useState(false);
  const [authors, setAuthors] = useState<string[]>([]);
  const [balls, setBalls] = useState<BallDraft[]>([]);
  const [baseBalls, setBaseBalls] = useState<BallDraft[]>([]);

  useEffect(() => {
    listSpecAuthors()
      .then(setAuthors)
      .catch(() => setAuthors([]));
  }, []);
  const leaving = useRef(false);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c, f, b] = await Promise.all([getCustomer(customerId), getCurrentFit(customerId), listBalls(customerId)]);
      setCustomer(c);
      setBase(f);
      const saved = snapshotToDraft(f.revision?.snapshot ?? null);
      setBaseDraft(saved);
      const savedBalls = b.map(ballToDraft);
      setBaseBalls(savedBalls);
      const stored = readStoredDraft(userId, customerId);
      setBalls(stored?.balls ?? savedBalls);
      if (stored) {
        // Unsaved work from before a session expiry or reload. Keep the lock
        // version it started from so a save in between still shows a conflict.
        setDraft(stored.draft);
        setExpectedLock(stored.baseLock);
        setChangeNote(stored.changeNote);
        setRestoredDraft(!draftsEqual(stored.draft, saved) || (!!stored.balls && !ballsEqual(stored.balls, savedBalls)));
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
  const ballErrors = useMemo(() => validateBalls(balls), [balls]);
  const ballsChanged = !ballsEqual(balls, baseBalls);
  const dirty = !!draft && !!baseDraft && (!draftsEqual(draft, baseDraft) || ballsChanged || restoredDraft);

  // Keep unsaved work in this tab so a network drop, reload or expired session doesn't lose it.
  useEffect(() => {
    if (!draft || !baseDraft) return;
    const key = draftKey(userId, customerId);
    try {
      if (draftsEqual(draft, baseDraft) && !ballsChanged && !changeNote) sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({ draft, baseLock: expectedLock, changeNote, savedAt: new Date().toISOString(), balls } satisfies StoredDraft),
        );
    } catch {
      // Storage full or unavailable; the in-memory draft is still kept.
    }
  }, [draft, baseDraft, balls, ballsChanged, expectedLock, changeNote, userId, customerId]);

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
    const el = (document.querySelector(`[data-control="${key}"]`) ?? document.getElementById(`field-${key}`)) as HTMLElement | null;
    if (el) {
      if (el.closest('details')) (el.closest('details') as HTMLDetailsElement).open = true;
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
    const firstBallError = Object.keys(ballErrors)[0];
    if (firstBallError) {
      document.querySelector<HTMLElement>(`[data-ball="${firstBallError}"] input`)?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    // Balls and measurements save side by side; balls only when they changed.
    const savingBalls = ballsChanged ? saveBalls(customerId, balls) : null;
    const savingFit = saveFit(customerId, expectedLock, draftToSnapshot(draft), changeNote);
    savingFit.catch(() => undefined);
    try {
      if (savingBalls) {
        // Saved balls get their ids, so a retry after a failed measurement save doesn't add them twice.
        const saved = (await savingBalls).map(ballToDraft);
        setBalls(saved);
        setBaseBalls(saved);
      }
      const result = await savingFit;
      if (embed) {
        // Saved: from here the only thing left is the embedding page's own step.
        leaving.current = true;
        discardStoredDraft();
        setBaseDraft(draft);
        setExpectedLock(result.lock_version);
        await embed.onSaved(result);
        return;
      }
      leave(`/customers/${customerId}${result.created || savingBalls ? '' : '?nochange=1'}`);
    } catch (err) {
      // If only the balls failed, the measurements may still have saved: carry on from that version.
      const fitSaved = await savingFit.catch(() => null);
      if (fitSaved) {
        setBaseDraft(draft);
        setExpectedLock(fitSaved.lock_version);
        setChangeNote('');
      }
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
  const problemCount = Object.keys(errors).length + Object.keys(ballErrors).length;
  const visibleErrors = showErrors ? errors : Object.fromEntries(Object.entries(errors).filter(([k]) => draft[k as FieldKey].text.trim() !== ''));

  return (
    <main className="page page--wide">
      {!embed && (
        <p className="breadcrumb no-print">
          <Link to={`/customers/${customerId}`}>← {customer.name}</Link>
        </p>
      )}
      <BowlerCard
        customer={customer}
        date={formatDate(new Date().toISOString())}
        actions={
          <button type="button" className="btn btn--small no-print" onClick={() => setEditingBowler(true)}>
            Edit bowler details
          </button>
        }
      >
        {FIELDS.filter((f) => f.group === 'identity').map((f) => (
          <FieldControl
            key={f.key}
            def={f}
            value={draft[f.key]}
            error={visibleErrors[f.key]}
            onChange={(patch) => setField(f.key, patch)}
            onFocus={() => setActiveField(f.key)}
          />
        ))}
      </BowlerCard>
      <h2 className="edit-heading">{base.revision ? 'Edit measurements' : 'Create digital specs'}</h2>
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
              setBalls(baseBalls);
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
            editor={{ draft, setField, onFocusField: setActiveField, authors }}
            activeField={activeField}
            caption="Spec sheet. Tap a box to type or scroll its value."
          />
          {noThumb && <p className="muted small">No Thumb: the thumb and span part of the sheet is hidden. Values saved earlier are kept.</p>}
          {Object.keys(visibleErrors).length > 0 && (
            <ul className="sheet-errors" role="alert">
              {FIELDS.filter((f) => visibleErrors[f.key]).map((f) => (
                <li key={f.key}>
                  <button type="button" className="linklike" onClick={() => focusField(f.key)}>
                    {f.label}
                  </button>
                  : <span className="field-error">{visibleErrors[f.key]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="editor__form">
          <fieldset className="fieldset">
            <legend>{GROUP_LABELS.notes}</legend>
            {draft.finger_grips.text === 'grips' && GRIP_BRAND_FIELDS.some((k) => draft[k].text === 'Other') && (
              <p className="muted small" role="note">
                Grip brand is Other: write which brand it is here.
              </p>
            )}
            {FIELDS.filter((f) => f.group === 'notes').map((f) => (
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

          <fieldset className="fieldset">
            <legend>{GROUP_LABELS.details}</legend>
            {FIELDS.filter((f) => f.group === 'details' && !(noThumb && f.key === 'thumb_system_details')).map((f) => (
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

          <BallsEditor balls={balls} errors={showErrors ? ballErrors : {}} onChange={setBalls} />

          <details className="fieldset more-measurements" open={OFF_SHEET.some((k) => !!visibleErrors[k])}>
            <summary>More measurements</summary>
            {FIELDS.filter((f) => OFF_SHEET.includes(f.key) && !(noThumb && f.thumbDependent)).map((f) => (
              <FieldControl
                key={f.key}
                def={f}
                value={draft[f.key]}
                error={visibleErrors[f.key]}
                onChange={(patch) => setField(f.key, patch)}
                onFocus={() => setActiveField(f.key)}
              />
            ))}
          </details>

          <fieldset className="fieldset">
            <legend>Save</legend>
            <label>
              Change note <span className="muted">(optional)</span>
              <input value={changeNote} maxLength={500} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Opened ring span 1/16" />
            </label>
            {showErrors && problemCount > 0 && (
              <p className="field-error" role="alert">
                Fix {problemCount} highlighted value{problemCount > 1 ? 's' : ''} before saving. Nothing you typed was removed.
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
            {saving ? 'Saving…' : (embed?.saveLabel ?? 'Save')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() =>
              embed ? embed.onCancel() : dirty ? navigate(`/customers/${customerId}`) : leave(`/customers/${customerId}`)
            }
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
      {editingBowler && (
        <EditCustomerDialog
          customer={customer}
          onClose={() => setEditingBowler(false)}
          onSaved={(next) => {
            setCustomer(next);
            setEditingBowler(false);
          }}
        />
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

  if (
    def.kind === 'enum_hand' ||
    def.kind === 'enum_play_style' ||
    def.kind === 'enum_thumb_mode' ||
    def.kind === 'enum_span_type' ||
    def.kind === 'enum_thumb_insert'
  ) {
    const options =
      def.kind === 'enum_play_style'
        ? [
            ['one_handed', 'One Handed'],
            ['two_handed', 'Two Handed'],
            ['', 'Not recorded'],
          ]
        : def.kind === 'enum_hand'
        ? [
            ['right', 'Right-handed'],
            ['left', 'Left-handed'],
            ['', 'Not recorded'],
          ]
        : def.kind === 'enum_thumb_mode'
          ? [
              ...(['fingertip', 'conventional', 'no_thumb'] as const).map((m) => [m, THUMB_MODE_LABELS[m]]),
              // Fits saved before the grip was recorded keep plain thumb-in until someone picks one.
              ...(value.text === 'thumb_in' ? [['thumb_in', THUMB_MODE_LABELS.thumb_in]] : []),
              ['', 'Not recorded'],
            ]
          : def.kind === 'enum_thumb_insert'
            ? [...THUMB_INSERT_TYPES.map((t) => [t, t]), ['', 'Not recorded']]
            : [
                ...(Object.entries(SPAN_TYPE_LABELS) as Array<[SpanType, string]>).map(([v, l]) => [v, l]),
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
        {def.kind === 'enum_span_type' && value.text && (
          <span className="muted small">{SPAN_TYPE_HINTS[value.text as SpanType]}</span>
        )}
      </div>
    );
  }

  if (def.kind === 'text_long') {
    return (
      <label className="field">
        <span className="field__label">{def.label}</span>
        <textarea id={id} rows={def.group === 'notes' ? 6 : 3} value={value.text} onChange={(e) => onChange({ text: e.target.value })} onFocus={onFocus} aria-invalid={!!error} aria-describedby={describedBy} />
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
      </div>
      {error && (
        <span id={errId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
