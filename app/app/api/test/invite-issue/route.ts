import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/lib/auth/session';
import { issueInviteForVerifiedUser } from '@/lib/auth/inviteIssuance';

function enabledForLocalVerifier(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.SANGAM_REAL_AUTH_TEST === '1';
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!enabledForLocalVerifier()) return new NextResponse(null, { status: 404 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const body = await request.json() as { weddingId?: unknown; guestId?: unknown };
    const weddingId = typeof body.weddingId === 'string' ? body.weddingId : '';
    const guestId = typeof body.guestId === 'string' ? body.guestId : '';
    if (!weddingId || !guestId) return NextResponse.json({ ok: false }, { status: 400 });
    const token = await issueInviteForVerifiedUser(user.id, weddingId, guestId);
    return NextResponse.json({ ok: true, token }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
}
