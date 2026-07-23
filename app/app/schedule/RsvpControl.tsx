'use client';

import { useState, useTransition } from 'react';
import { proposeAction, confirmAction } from './rsvp-actions';
import type { AttendanceStatus } from '@/lib/commands/rsvp';

const CHOICES: { key: AttendanceStatus; label: string }[] = [
  { key: 'accepted', label: 'Accept' },
  { key: 'declined', label: 'Decline' },
  { key: 'tentative', label: 'Maybe' },
];

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  accepted: 'Attending',
  declined: 'Not attending',
  tentative: 'Maybe',
};

const PILL: Record<AttendanceStatus, string> = {
  accepted: 'is-attending',
  declined: 'is-declined',
  tentative: 'is-maybe',
};

function friendly(msg: string): string {
  if (/rsvp conflict/i.test(msg)) return 'Someone updated this RSVP a moment ago — please review and try again.';
  if (/not authorized/i.test(msg)) return 'You’re not able to RSVP for this guest.';
  if (/closed|deadline|draft/i.test(msg)) return 'RSVPs for this event are closed.';
  return 'Something went wrong. Please try again.';
}

// Two-step RSVP: choose -> ECHO ("Mark X as Y? Confirm") -> confirm. The propose step writes nothing to
// attendance; only Confirm commits (via confirm_rsvp_change). initialEcho is a preview-only affordance so
// the confirm state can be shown in a static screenshot; it never runs an action.
export default function RsvpControl({
  invitationGuestId,
  label,
  status,
  rowVersion,
  initialEcho = null,
}: {
  invitationGuestId: string;
  label: string;
  status: AttendanceStatus | null;
  rowVersion: number | null;
  initialEcho?: AttendanceStatus | null;
}) {
  const [pending, startTransition] = useTransition();
  const [echo, setEcho] = useState<{ proposalId: string; status: AttendanceStatus } | null>(
    initialEcho ? { proposalId: 'preview', status: initialEcho } : null,
  );
  const [done, setDone] = useState<AttendanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = done ?? status;

  function propose(next: AttendanceStatus) {
    setError(null);
    startTransition(async () => {
      const res = await proposeAction(invitationGuestId, next);
      if (!res.ok) return setError(friendly(res.error));
      setEcho({ proposalId: res.proposalId, status: next });
    });
  }

  function confirm() {
    if (!echo) return;
    setError(null);
    startTransition(async () => {
      const res = await confirmAction(echo.proposalId, rowVersion);
      if (!res.ok) return setError(friendly(res.error));
      setDone(echo.status);
      setEcho(null);
    });
  }

  return (
    <div className="sg-rsvp">
      <div className="sg-rsvp__label">
        <span>Your RSVP:</span>
        {current ? (
          <span className={`sg-pill ${PILL[current]}`}>{STATUS_LABEL[current]}</span>
        ) : (
          <span className="sg-pill is-none">Not responded</span>
        )}
      </div>

      {echo ? (
        <div className="sg-confirm">
          <p>
            Mark <strong>{label}</strong> as <strong>{STATUS_LABEL[echo.status]}</strong>? Nothing is saved until
            you confirm.
          </p>
          <div className="sg-confirm__row">
            <button type="button" className="sg-btn sg-btn--primary" onClick={confirm} disabled={pending}>
              {pending ? 'Confirming…' : 'Confirm'}
            </button>
            <button type="button" className="sg-btn" onClick={() => setEcho(null)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="sg-choices">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`sg-btn${current === c.key ? ' is-selected' : ''}`}
              onClick={() => propose(c.key)}
              disabled={pending}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="sg-error">{error}</div>}
    </div>
  );
}
