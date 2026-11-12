import { pathToFileURL } from 'node:url';

export const PREVIEW_BUILD_MARKER = '[vercel-preview]';

export function shouldBuildVercelDeployment({ branch, message = '', environment = '' }) {
  if (!branch || environment === 'production' || branch === 'main') return true;
  return message.includes(PREVIEW_BUILD_MARKER);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shouldBuild = shouldBuildVercelDeployment({
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? '',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '',
    environment: process.env.VERCEL_ENV ?? '',
  });
  process.stdout.write(shouldBuild ? 'Vercel build allowed\n' : 'Vercel build skipped by repository policy\n');
  process.exitCode = shouldBuild ? 1 : 0;
}
