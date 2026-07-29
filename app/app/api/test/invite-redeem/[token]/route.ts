import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/lib/auth/session';
import { redeemInviteForVerifiedUser } from '@/lib/auth/inviteRedemption';

// Local real-GoTrue verifier only. `next dev` runs with NODE_ENV=development; production requests always
// receive 404 even if an operator accidentally leaves the verifier switch set.
function enabledForLocalVerifier(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.SANGAM_REAL_AUTH_TEST === '1';
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  if (!enabledForLocalVerifier()) return new NextResponse(null, { status: 404 });
  const { token } = await params;
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    await redeemInviteForVerifiedUser(token, user);
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
}
