import { cookies } from 'next/headers';
import { userClient, type AppSupabaseClient } from './clients';

// Read-only user-session client for Server Components (RLS applies to every query). Cookies are NOT
// written here — the middleware refreshes them. Route Handlers / Server Actions that must set cookies use
// serverClientRW() instead. Cast to AppSupabaseClient (see clients.ts) so the command/data layer gets
// supabase-js' rpc/query typing; it's the same runtime client.
export async function pageClient(): Promise<AppSupabaseClient> {
  const store = await cookies();
  return userClient({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: () => {},
  }) as unknown as AppSupabaseClient;
}
