import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  rewrites: Array<{ source: string; destination: string | { service: string; path?: string } }>;
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
  });

  it('preserves built assets and public logo files before the SPA fallback', () => {
    const assets = vercel.rewrites.findIndex((route) => route.source === '/assets/(.*)');
    const logos = vercel.rewrites.findIndex((route) => route.source === '/logo-(.*)');
    const fallback = vercel.rewrites.findIndex((route) => route.source === '/(.*)');
    expect(assets).toBeGreaterThanOrEqual(0);
    expect(logos).toBeGreaterThan(assets);
    expect(fallback).toBeGreaterThan(logos);
    expect(vercel.rewrites[assets].destination).toEqual({ service: 'frontend' });
    expect(vercel.rewrites[logos].destination).toEqual({ service: 'frontend' });
  });

  it('serves the Vite entry document for direct SPA deep links', () => {
    const fallback = vercel.rewrites.find((route) => route.source === '/(.*)');
    expect(fallback?.destination).toEqual({ service: 'frontend', path: '/index.html' });
  });

  it('exposes Football Dynasty without a build-time opt-in that is absent in production', () => {
    expect(router).toContain('<Route path="/dynasty" element={<PageTransition><FootballDynastyScreen /></PageTransition>} />');
    expect(router).not.toContain('import.meta.env.VITE_FD_API_URL ?');
  });
});
