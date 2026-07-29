export const dynamic='force-dynamic';

export async function GET(){
  return Response.json({
    status:'ok',
    service:'sangam',
    configured:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY),
    release:process.env.SOURCE_COMMIT??process.env.COOLIFY_GIT_COMMIT_SHA??'unknown',
  },{headers:{'cache-control':'no-store'}});
}
