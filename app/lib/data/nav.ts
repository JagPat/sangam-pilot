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
  { href: '/host/stay', label: 'Stay & travel', key: 'stay' },
  { href: '/host/groups', label: 'Families & admins', key: 'groups' },
  { href: '/host/vendors', label: 'Vendors', key: 'vendors' },
];

const COSTS_SECTION: NavSection = { href: '/host/costs', label: 'Costs', key: 'costs' };
const FINANCE_SECTION: NavSection = { href: '/host/finance', label: 'Private finance', key: 'finance' };
const PLATFORM_SECTION: NavSection = { href: '/host/platform', label: 'Platform', key: 'platform' };
const FAMILY_SECTIONS: NavSection[] = [
  { href: '/host/manage', label: 'Guests', key: 'manage' },
  { href: '/host/events', label: 'Events', key: 'events' },
  { href: '/host/stay-overview', label: 'Stay & travel', key: 'stay-overview' },
  { href: '/host/budget', label: 'Finance & vendors', key: 'budget' },
];

export function navigationForRoles(
  roles: string[],
  isPlatformSuperAdmin = false,
): Pick<OrganizerNav, 'roleLabel' | 'sections'> {
  const rs = new Set(roles);
  const sections: NavSection[] = [];
  const add = (items: NavSection[]) => items.forEach((item) => {
    if (!sections.some((section) => section.key === item.key)) sections.push(item);
  });
  if (rs.has('wedding_owner')) add(OWNER_SECTIONS);
  if (rs.has('host_group_admin')) add(FAMILY_SECTIONS);
  if (rs.has('event_manager')) add([COSTS_SECTION]);
  if (rs.has('finance_admin')) add([FINANCE_SECTION]);
  if (isPlatformSuperAdmin) add([PLATFORM_SECTION]);
  const roleLabel = isPlatformSuperAdmin ? 'Platform administrator'
    : rs.has('event_manager') ? 'Event manager'
    : rs.has('finance_admin') ? 'Finance administrator'
    : rs.has('wedding_owner') ? 'Wedding administrator'
    : rs.has('host_group_admin') ? 'Family admin'
    : rs.has('co_host') ? 'Co-host (view only)' : null;
  return { roleLabel, sections };
}

export async function getOrganizerNav(db: AppSupabaseClient): Promise<OrganizerNav> {
  const app = db.schema('app');

  const { data: accId, error: eAcc } = await app.rpc('current_account_id');
  const accountId = (accId as unknown as string | null) ?? null;
  if (eAcc || !accountId) return { email: null, roleLabel: null, sections: [] };

  const [acc, roles, platform] = await Promise.all([
    app.from('account').select('email').eq('id', accountId).maybeSingle(),
    app.from('operator_role').select('role').eq('account_id', accountId),
    app.rpc('is_platform_super_admin'),
  ]);
  const email = acc.data?.email ?? null;
  const rs = new Set((roles.data ?? []).map((r) => r.role));

  return { email, ...navigationForRoles([...rs], platform.data === true) };
}
