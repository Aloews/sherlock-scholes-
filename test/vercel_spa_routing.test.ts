import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  services: { frontend: { routes: Array<{ src: string; transforms: Array<{ type: string; op: string; args: string }> }> } };
  rewrites: Array<{ source: string; destination: string | { service: string } }>;
};
const router = readFileSync('src/app/Router.tsx', 'utf8');

describe('Vercel SPA and Football Dynasty routing', () => {
  it('routes API and health requests to the Rust service before the frontend fallback', () => {
    const api = vercel.rewrites.findIndex((route) => route.source === '/api/v1/(.*)');
    const health = vercel.rewrites.findIndex((route) => route.source === '/health/(.*)');
    const fallback = vercel.rewrites.findIndex((route) => route.source === '/(.*)');
    expect(api).toBeGreaterThanOrEqual(0);
    expect(health).toBeGreaterThan(api);
    expect(fallback).toBeGreaterThan(health);
    expect(vercel.rewrites[api].destination).toEqual({ service: 'football_dynasty' });
    expect(vercel.rewrites[health].destination).toEqual({ service: 'football_dynasty' });
    expect(vercel.rewrites[fallback].destination).toEqual({ service: 'frontend' });
  });

  it('preserves built assets and public logos inside the frontend service', () => {
    expect(vercel.services.frontend.routes).toEqual([
      { src: '/assets/(.*)', transforms: [{ type: 'request.path', op: 'set', args: '/assets/$1' }] },
      { src: '/logo-(.*)', transforms: [{ type: 'request.path', op: 'set', args: '/logo-$1' }] },
      { src: '/(.*)', transforms: [{ type: 'request.path', op: 'set', args: '/index.html' }] },
    ]);
  });

  it('exposes Football Dynasty on the same-origin API without a build-time opt-in', () => {
    expect(router).toContain('<Route path="/dynasty" element={<PageTransition><FootballDynastyScreen /></PageTransition>} />');
    expect(router).not.toContain('import.meta.env.VITE_FD_API_URL ?');
  });
});
