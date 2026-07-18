import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the Docker/Coolify image is small
  // and needs no npm install at runtime.
  output: 'standalone',

  // Pin the file-tracing root to THIS app so a stray lockfile higher up the tree can't make
  // build tracing non-deterministic (silences the "multiple lockfiles" workspace-root warning).
  outputFileTracingRoot: __dirname,

  // Lint tooling (eslint-config-next) is deliberately deferred to the UI phase — this backend-focused
  // scaffold has no React screens to lint yet. Opting out of the build-time lint step keeps the
  // dependency tree minimal (and `npm audit` at 0) and stops next build nagging about the missing
  // Next.js ESLint plugin. Re-enable by removing this once the UI work (and eslint-config-next) lands.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
