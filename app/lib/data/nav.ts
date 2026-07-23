import type { AppSupabaseClient } from '../supabase/clients';

// Role-aware organizer navigation. Reads the signed-in account's operator roles (RLS lets a member read
// their own operator_role rows) and returns exactly the console sections that role can use — so the menu
// is "what YOU can do", not a fixed list — along with who they are. The wedding owner (the event manager)
// gets the full console. Non-owner operators (family admin / co-host) have no owner-scoped screens wired
// yet — every organizer loader is owner-scoped today — so they get an identity-only header instead of
// links that would dead-end. When family-scoped screens land, add their sections here and the menu adapts.

export type NavSection = { href: string; label: string; key: string };
export type OrganizerNav = { email: string | null; roleLabel: string | null; sections: NavSection[] };

export const OWNER_SECTIONS: NavSection[] = [
  { href: '/host', label: 'Dashboard', key: 'dashboard' },
  { href: '/host/setup', label: 'Venues & events', key: 'setup' },
  { href: '/host/manage', label: 'Guests', key: 'manage' },
  { href: '/host/groups', label: 'Families & admins', key: 'groups' },
  { href: '/host/vendors', label: 'Vendors', key: 'vendors' },
  { href: '/host/finance', label: 'Finance', key: 'finance' },
];

export async function getOrganizerNav(db: AppSupabaseClient): Promise<OrganizerNav> {
  const app = db.schema('app');

  const { data: accId, error: eAcc } = await app.rpc('current_account_id');
  const accountId = (accId as unknown as string | null) ?? null;
  if (eAcc || !accountId) return { email: null, roleLabel: null, sections: [] };

  const [acc, roles] = await Promise.all([
    app.from('account').select('email').eq('id', accountId).maybeSingle(),
    app.from('operator_role').select('role').eq('account_id', accountId),
  ]);
  const email = acc.data?.email ?? null;
  const rs = new Set((roles.data ?? []).map((r) => r.role));

  if (rs.has('wedding_owner')) {
    return { email, roleLabel: 'Event manager', sections: OWNER_SECTIONS };
  }
  if (rs.has('host_group_admin') || rs.has('co_host')) {
    return { email, roleLabel: 'Family admin', sections: [] };
  }
  return { email, roleLabel: null, sections: [] };
}
