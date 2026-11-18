import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  services: { frontend: { routes: Array<{ src: string; dest: string }> } };
  rewrites: Array<{ source: string; destination: string | { service: string } }>;
};
const router = readFileSync('src/app/Router.tsx', 'utf8');
const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
const locales = ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh'] as const;
const translations = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(`src/shared/i18n/locales/${locale}.json`, 'utf8')) as {
      home?: { dynasty_link?: string };
    },
  ]),
) as Record<(typeof locales)[number], { home?: { dynasty_link?: string } }>;

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

  it('preserves static files and falls back to index.html inside the frontend service', () => {
    expect(vercel.services.frontend.routes).toEqual([
      { src: '/assets/(.*)', dest: '/assets/$1' },
      { src: '/logo-(.*)', dest: '/logo-$1' },
      { src: '/(.*)', dest: '/index.html' },
    ]);
  });

  it('exposes Football Dynasty in home navigation without a build-time opt-in', () => {
    expect(router).toContain('<Route path="/dynasty" element={<PageTransition><FootballDynastyScreen /></PageTransition>} />');
    expect(home).toContain('label={t(\'home.dynasty_link\')}');
    expect(home).toContain('onClick={() => navigate(\'/dynasty\')}');
    expect(home).not.toContain('import.meta.env.VITE_FD_API_URL');
  });

  it('has a non-empty Football Dynasty label in all supported locales', () => {
    for (const locale of locales) {
      expect(translations[locale].home?.dynasty_link?.trim(), locale).toBeTruthy();
    }
  });
});
