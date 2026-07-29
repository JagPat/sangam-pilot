import type { AppSupabaseClient } from '../supabase/clients';

export type CreatorAccess = { canCreateWedding: boolean };

export function canRenderWeddingCreation(access: CreatorAccess): boolean {
  return access.canCreateWedding;
}

export async function getCreatorAccess(db: AppSupabaseClient): Promise<CreatorAccess> {
  const { data, error } = await db.schema('app').rpc('current_account_can_create_wedding');
  if (error) throw error;
  return { canCreateWedding: data === true };
}
