import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getPlatformAccess } from '@/lib/data/platform';
import { HostNav } from '../HostNav';
import { setWeddingCreatorAccess } from './actions';
import { PlatformProvisioningView } from './PlatformProvisioningView';

export const dynamic = 'force-dynamic';

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireVerifiedUser('/host/platform');
  const access = await getPlatformAccess(await pageClient());
  if (!access.isPlatformSuperAdmin) {
    return (
      <main className="sg-host"><div className="sg-host-shell">
        <HostNav current="platform" />
        <div className="sg-banner is-err">Platform administrator access is required.</div>
      </div></main>
    );
  }

  const { ok, err } = await searchParams;
  return (
    <main className="sg-host"><div className="sg-host-shell">
      <HostNav current="platform" />
      <div className="sg-pagehead">
        <h1>Platform administration</h1>
        <p>Provision planners who are allowed to create new client weddings.</p>
      </div>
      {ok ? <div className="sg-banner is-ok">Creator access updated.</div> : null}
      {err ? <div className="sg-banner is-err">Creator access could not be updated.</div> : null}
      <PlatformProvisioningView action={setWeddingCreatorAccess} />
    </div></main>
  );
}
