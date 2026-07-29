import { serviceCommand } from '@/lib/supabase/clients';

export function inviteSiteOrigin(): string {
  const configuredValue = process.env.PUBLIC_SITE_URL;
  if (!configuredValue) throw new Error('PUBLIC_SITE_URL is required for invite issuance');

  let configured: URL;
  try {
    configured = new URL(configuredValue);
  } catch {
    throw new Error('PUBLIC_SITE_URL must be a valid HTTPS origin');
  }
  if (
    configured.protocol !== 'https:'
    || configured.username
    || configured.password
    || configured.pathname !== '/'
    || configured.search
    || configured.hash
    || (configuredValue !== configured.origin && configuredValue !== `${configured.origin}/`)
  ) {
    throw new Error('PUBLIC_SITE_URL must be an HTTPS origin without a path, query, or fragment');
  }

  return configured.origin;
}

export function buildInviteUrl(rawToken: string, siteOrigin = inviteSiteOrigin()): string {
  return new URL(`/invite/${encodeURIComponent(rawToken)}`, siteOrigin).toString();
}

// The auth user id must come from auth.getUser(). The service lookup converts that verified identity to the
// immutable app account id; PostgreSQL then independently proves active wedding-owner membership.
export async function issueInviteForVerifiedUser(
  authUserId: string,
  weddingId: string,
  guestId: string,
): Promise<string> {
  return serviceCommand('invite_issuance', weddingId, async (db) => {
    const { data: actor, error: actorError } = await db
      .schema('app')
      .from('account')
      .select('id')
      .eq('auth_user_id', authUserId)
      .single();
    if (actorError || !actor) throw actorError ?? new Error('verified account not found');

    const { data: rawToken, error } = await db.schema('app').rpc('issue_guest_access_link', {
      p_actor: actor.id,
      p_wedding: weddingId,
      p_guest: guestId,
    });
    if (error || !rawToken) throw error ?? new Error('invite issuance failed');
    return rawToken;
  });
}
