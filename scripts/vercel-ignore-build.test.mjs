import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PREVIEW_BUILD_MARKER, shouldBuildVercelDeployment } from './vercel-ignore-build.mjs';

test('production deployments always build, regardless of branch name', () => {
  assert.equal(shouldBuildVercelDeployment({ branch: 'release', environment: 'production' }), true);
});

test('main always builds', () => {
  assert.equal(shouldBuildVercelDeployment({ branch: 'main', environment: 'preview' }), true);
});

test('feature branches skip routine preview builds', () => {
  assert.equal(shouldBuildVercelDeployment({ branch: 'feature/game-core', message: 'fix: update timer', environment: 'preview' }), false);
});

test('an explicit preview marker allows one planned preview', () => {
  assert.equal(shouldBuildVercelDeployment({ branch: 'feature/game-core', message: `feat: release candidate ${PREVIEW_BUILD_MARKER}`, environment: 'preview' }), true);
});

test('preview metadata is enough to skip when the branch ref is unavailable', () => {
  assert.equal(shouldBuildVercelDeployment({ branch: '', message: '', environment: 'preview' }), false);
});

test('missing branch and environment metadata fails open', () => {
  assert.equal(shouldBuildVercelDeployment({ branch: '', message: '', environment: '' }), true);
});

test('both Vercel service roots have a valid ignore command and no ambiguous top-level command', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.ignoreCommand, undefined);
  assert.equal(config.services.frontend.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
  assert.equal(config.services.football_dynasty.root, 'services');
  assert.equal(config.services.football_dynasty.entrypoint, 'football-dynasty/Dockerfile.vercel');
  assert.equal(config.services.football_dynasty.ignoreCommand, 'node ../scripts/vercel-ignore-build.mjs');
});

test('the backend service ignore command resolves from the configured services root', () => {
  const servicesRoot = fileURLToPath(new URL('../services/', import.meta.url));
  const result = spawnSync(process.execPath, ['../scripts/vercel-ignore-build.mjs'], {
    cwd: servicesRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL_GIT_COMMIT_REF: 'feature/alias-core',
      VERCEL_GIT_COMMIT_MESSAGE: 'fix: routine change',
      VERCEL_ENV: 'preview',
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /preview skipped/i);
});

test('the Vercel command maps build/skip decisions to the documented exit codes', () => {
  const script = fileURLToPath(new URL('./vercel-ignore-build.mjs', import.meta.url));
  const skipped = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, VERCEL_GIT_COMMIT_REF: 'feature/game-core', VERCEL_GIT_COMMIT_MESSAGE: 'fix: routine work', VERCEL_ENV: 'preview' },
  });
  const built = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, VERCEL_GIT_COMMIT_REF: 'feature/game-core', VERCEL_GIT_COMMIT_MESSAGE: `release ${PREVIEW_BUILD_MARKER}`, VERCEL_ENV: 'preview' },
  });
  assert.equal(skipped.status, 0);
  assert.equal(built.status, 1);
});
