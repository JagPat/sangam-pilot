import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './route';

const saved={source:process.env.SOURCE_COMMIT,coolify:process.env.COOLIFY_GIT_COMMIT_SHA};
afterEach(()=>{
  if(saved.source===undefined)delete process.env.SOURCE_COMMIT;else process.env.SOURCE_COMMIT=saved.source;
  if(saved.coolify===undefined)delete process.env.COOLIFY_GIT_COMMIT_SHA;else process.env.COOLIFY_GIT_COMMIT_SHA=saved.coolify;
});

describe('health release identity',()=>{
  it('uses the live Coolify commit instead of a stale manual SOURCE_COMMIT',async()=>{
    process.env.SOURCE_COMMIT='old-static-value';
    process.env.COOLIFY_GIT_COMMIT_SHA='current-coolify-sha';
    const body=await GET().then((response)=>response.json());
    expect(body.release).toBe('current-coolify-sha');
  });
});
