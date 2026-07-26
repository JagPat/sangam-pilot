import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));

vi.mock('@supabase/ssr', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@supabase/ssr')>();
  return { ...original, createServerClient: mocks.createServerClient };
});

describe('updateSession', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createServerClient.mockReset();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  });

  it('calls getUser and copies a rotated cookie to request and response', async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            { name: 'sb-auth', value: 'rotated', options: { path: '/', maxAge: 3600 } },
          ]);
          return { data: { user: { id: 'u1' } }, error: null };
        },
      },
    }));

    const { updateSession } = await import('./middleware');
    const request = new NextRequest('https://sangam.vitan.in/schedule');
    const response = await updateSession(request);

    expect(request.cookies.get('sb-auth')?.value).toBe('rotated');
    expect(response.cookies.get('sb-auth')?.value).toBe('rotated');
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    expect(mocks.createServerClient.mock.calls[0][2].cookieOptions).toMatchObject({
      path: '/',
      sameSite: 'lax',
      secure: true,
      maxAge: 400 * 24 * 60 * 60,
    });
  });
});
