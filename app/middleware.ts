import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Runs Supabase session refresh on every request except static assets. Keep the matcher in sync with
// the Supabase-SSR guidance: skip _next internals and common static file types so we don't refresh on
// asset fetches.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next internals and public static assets (images, fonts, styles, scripts, docs, manifests) so
    // session refresh runs on real navigations/data requests only, not asset fetches.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|woff|woff2|ttf|otf|eot|pdf|txt|webmanifest)$).*)',
  ],
};
