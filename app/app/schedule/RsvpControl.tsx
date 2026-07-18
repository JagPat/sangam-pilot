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

function friendly(msg: string): string {
  if (/rsvp conflict/i.test(msg)) return 'Someone updated this RSVP a moment ago — please review and try again.';
  if (/not authorized/i.test(msg)) return 'You’re not able to RSVP for this guest.';
  if (/closed|deadline|draft/i.test(msg)) return 'RSVPs for this event are closed.';
  return 'Something went wrong. Please try again.';
}

const btn = {
  padding: '6px 12px',
  fontSize: 14,
  cursor: 'pointer',
  borderRadius: 6,
  border: '1px solid #ccc',
  background: '#fff',
} as const;

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
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>
        {current ? (
          <>
            Your RSVP: <strong>{STATUS_LABEL[current]}</strong>
          </>
        ) : (
          <>Not responded yet</>
        )}
      </div>

      {echo ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>
            Mark <strong>{label}</strong> as <strong>{STATUS_LABEL[echo.status]}</strong>? Nothing is saved
            until you confirm.
          </span>
          <button
            type="button"
            style={{ ...btn, background: '#111', color: '#fff', borderColor: '#111' }}
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'Confirming…' : 'Confirm'}
          </button>
          <button type="button" style={btn} onClick={() => setEcho(null)} disabled={pending}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              style={{ ...btn, ...(current === c.key ? { borderColor: '#111', fontWeight: 600 } : {}) }}
              onClick={() => propose(c.key)}
              disabled={pending}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ color: '#b00020', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  );
}
