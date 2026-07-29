import type { AppSupabaseClient } from '../supabase/clients';

export const PLATFORM_CREATOR_LABEL = 'May create client weddings';
export const CREATOR_ACCESS_OPTIONS = [
  { value: 'true', label: 'Enable' },
  { value: 'false', label: 'Disable' },
] as const;

export async function getPlatformAccess(db: AppSupabaseClient): Promise<{ isPlatformSuperAdmin: boolean }> {
  const { data, error } = await db.schema('app').rpc('is_platform_super_admin');
  if (error) throw error;
  return { isPlatformSuperAdmin: data === true };
}
