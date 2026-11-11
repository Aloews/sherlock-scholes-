import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  services: { frontend: Record<string, unknown> };
  rewrites: Array<{ source: string; destination: string | { service: string } }>;
};
const router = readFileSync('src/app/Router.tsx', 'utf8');

describe('Vercel SPA and Football Dynasty routing', () => {
  it('routes API and health requests to the Rust service before the SPA fallback', () => {
    const api = vercel.rewrites.findIndex((route) => route.source === '/api/v1/(.*)');
    const health = vercel.rewrites.findIndex((route) => route.source === '/health/(.*)');
    const fallback = vercel.rewrites.findIndex((route) => route.source === '/(.*)');
    expect(api).toBeGreaterThanOrEqual(0);
    expect(health).toBeGreaterThan(api);
    expect(fallback).toBeGreaterThan(health);
    expect(vercel.rewrites[api].destination).toEqual({ service: 'football_dynasty' });
    expect(vercel.rewrites[health].destination).toEqual({ service: 'football_dynasty' });
  });

  it('uses Vercel static-file precedence and the documented Vite SPA fallback', () => {
    expect(vercel.rewrites).toHaveLength(3);
    expect(vercel.rewrites[2]).toEqual({ source: '/(.*)', destination: '/index.html' });
    expect(vercel.services.frontend).not.toHaveProperty('routes');
  });

  it('exposes Football Dynasty on the same-origin API without a build-time opt-in', () => {
    expect(router).toContain('<Route path="/dynasty" element={<PageTransition><FootballDynastyScreen /></PageTransition>} />');
    expect(router).not.toContain('import.meta.env.VITE_FD_API_URL ?');
  });
});
