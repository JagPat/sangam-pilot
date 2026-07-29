'use client';

import { useActionState } from 'react';
import { issueGuestAccessLink, type IssueAccessLinkState } from './actions';

const initialState: IssueAccessLinkState = { url: null, error: null };

export function IssueAccessLinkForm({ weddingId, guestId }: { weddingId: string; guestId: string }) {
  const [state, action, pending] = useActionState(issueGuestAccessLink, initialState);

  return (
    <form action={action} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input type="hidden" name="weddingId" value={weddingId} />
      <input type="hidden" name="guestId" value={guestId} />
      <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm" disabled={pending}>
        {pending ? 'Issuing secure link…' : 'Issue secure invite link'}
      </button>
      {state.error ? <p className="sg-muted" style={{ margin: 0 }}>{state.error}</p> : null}
      {state.url ? (
        <label className="sg-field">
          <span>One-time invite link — copy it now</span>
          <input className="sg-input" value={state.url} readOnly aria-label="One-time invite link" />
        </label>
      ) : null}
    </form>
  );
}
