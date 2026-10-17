// The bowler block from the top of the paper sheet: name, date, contact lines,
// hand and one or two handed. On the edit screen the hand and style rows are
// replaced by their controls (children).

import type { ReactNode } from 'react';
import { HAND_LABELS, PLAY_STYLE_LABELS, type Hand, type PlayStyle } from '../measurements/schema';
import type { Customer } from './api';

function Line({ label, value, children }: { label: string; value: string | null | undefined; children?: ReactNode }) {
  return (
    <div className="bowler__line">
      <dt>{label}</dt>
      <dd>
        {value || <span className="muted">–</span>}
        {value && children}
      </dd>
    </div>
  );
}

export function BowlerCard({
  customer,
  date,
  hand,
  playStyle,
  actions,
  children,
}: {
  customer: Customer;
  date: string | null;
  hand?: string | null;
  playStyle?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const place = [customer.city, [customer.state, customer.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <section className="bowler" aria-label="Bowler">
      <div className="bowler__head">
        <h1>{customer.name}</h1>
        {actions}
      </div>
      <dl className="bowler__lines">
        <Line label="Date" value={date} />
        <Line label="Phone" value={customer.phone}>
          {customer.phone_mobile && <span className="tag tag--plain bowler__mobile">Mobile</span>}
        </Line>
        <Line label="Email" value={customer.email} />
        <Line label="Address" value={customer.address} />
        <Line label="City, State, Zip" value={place} />
        {!children && (
          <>
            <Line label="Hand" value={hand ? (HAND_LABELS[hand as Hand] ?? hand) : null} />
            <Line label="One or two handed" value={playStyle ? (PLAY_STYLE_LABELS[playStyle as PlayStyle] ?? playStyle) : null} />
          </>
        )}
      </dl>
      {customer.notes && <p className="muted bowler__notes">{customer.notes}</p>}
      {children && <div className="bowler__controls">{children}</div>}
    </section>
  );
}
