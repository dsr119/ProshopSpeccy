import {
  BALL_WEIGHTS,
  emptyBall,
  formatWeight,
  type Ball,
  type BallDraft,
} from "./api";

/** The bowler's balls in the spec sheet editor: one row per ball, added and removed freely. */
export function BallsEditor({
  balls,
  errors,
  onChange,
}: {
  balls: BallDraft[];
  errors: Record<string, string>;
  onChange: (next: BallDraft[]) => void;
}) {
  const set = (key: string, patch: Partial<BallDraft>) =>
    onChange(balls.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  return (
    <fieldset className="fieldset balls-editor">
      <legend>Bowling balls</legend>
      {balls.length === 0 && (
        <p className="muted small">
          No balls yet. Add each ball from the back of the paper sheet.
        </p>
      )}
      <ol className="balls-editor__list">
        {balls.map((b, i) => (
          <li
            key={b.key}
            className="balls-editor__row"
            data-testid="ball-row"
            data-ball={b.key}
          >
            <label className="balls-editor__name">
              Ball {i + 1}
              <input
                value={b.name}
                maxLength={120}
                placeholder="e.g. Storm Phaze II"
                aria-invalid={!!errors[b.key]}
                onChange={(e) => set(b.key, { name: e.target.value })}
              />
            </label>
            <label className="balls-editor__weight">
              Weight
              <select
                value={b.weight}
                onChange={(e) => set(b.key, { weight: e.target.value })}
              >
                <option value="">–</option>
                {BALL_WEIGHTS.map((w) => (
                  <option key={w} value={String(w)}>
                    {w} lb
                  </option>
                ))}
              </select>
            </label>
            <label className="balls-editor__layout">
              Layout
              <input
                value={b.layout}
                maxLength={120}
                placeholder="e.g. 4 1/2 x 4 x 2"
                onChange={(e) => set(b.key, { layout: e.target.value })}
              />
            </label>
            <label className="balls-editor__notes">
              Notes <span className="muted">(optional)</span>
              <input
                value={b.notes}
                maxLength={300}
                onChange={(e) => set(b.key, { notes: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn btn--small balls-editor__remove"
              aria-label={`Remove ball ${i + 1}`}
              onClick={() => onChange(balls.filter((x) => x.key !== b.key))}
            >
              Remove
            </button>
            {errors[b.key] && (
              <span className="field-error balls-editor__error">
                {errors[b.key]}
              </span>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn btn--small"
        onClick={() => onChange([...balls, emptyBall()])}
      >
        Add a ball
      </button>
    </fieldset>
  );
}

/** The bowler's balls, read only, on the bowler's page and the printout. */
export function BallsList({ balls }: { balls: Ball[] }) {
  return (
    <section className="balls-list" aria-label="Bowling balls">
      <h3>Bowling balls</h3>
      {balls.length === 0 ? (
        <p className="muted">No balls recorded.</p>
      ) : (
        <div className="balls-list__wrap">
          <table className="balls-list__table">
            <thead>
              <tr>
                <th scope="col">Ball</th>
                <th scope="col">Weight</th>
                <th scope="col">Layout</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {balls.map((b) => (
                <tr key={b.id}>
                  <th scope="row">{b.name}</th>
                  <td>{formatWeight(b.weight_lbs)}</td>
                  <td>{b.layout}</td>
                  <td>{b.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
