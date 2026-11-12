import { pathToFileURL } from 'node:url';

export const PREVIEW_BUILD_MARKER = '[vercel-preview]';

export function shouldBuildVercelDeployment({ branch, message = '', environment = '' }) {
  if (environment === 'production' || branch === 'main') return true;
  if (message.includes(PREVIEW_BUILD_MARKER)) return true;
  if (environment === 'preview' || branch) return false;
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shouldBuild = shouldBuildVercelDeployment({
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? '',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '',
    environment: process.env.VERCEL_ENV ?? '',
  });
  const reason = shouldBuild ? 'build allowed' : 'preview skipped: release marker absent';
  process.stdout.write(`Vercel ${reason} (environment=${process.env.VERCEL_ENV ?? 'unknown'}, branch=${process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown'})\\n`);
  process.exitCode = shouldBuild ? 1 : 0;
}
