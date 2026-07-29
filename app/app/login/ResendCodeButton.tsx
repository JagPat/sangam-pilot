'use client';

import { useEffect, useState } from 'react';

const RESEND_DELAY_SECONDS = 60;

export function ResendCodeButton({
  action,
  email,
  nextPath,
}: {
  action: (formData: FormData) => Promise<void>;
  email: string;
  nextPath: string;
}) {
  const [remaining, setRemaining] = useState(RESEND_DELAY_SECONDS);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  return (
    <form action={action}>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
      <button type="submit" className="sg-btn sg-btn--block" disabled={remaining > 0}>
        {remaining > 0 ? `Send a new code in ${remaining}s` : 'Send a new code'}
      </button>
    </form>
  );
}
