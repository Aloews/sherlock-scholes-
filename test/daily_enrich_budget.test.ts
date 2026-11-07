import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const WF = '.github/workflows/daily-enrich.yml';

function workflow(): string {
  return readFileSync(WF, 'utf8');
}

function jobBlock(name: string): string {
  const source = workflow();
  const marker = '  ' + name + ':\n';
  const start = source.indexOf(marker);
  expect(start, 'job "' + name + '" is missing').toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + marker.length);
  const next = /\n  [a-zA-Z0-9_-]+:\n/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function jobTimeout(name: string): number {
  const match = /^\s+timeout-minutes:\s*(\d+)/m.exec(jobBlock(name));
  expect(match, 'job "' + name + '" has no timeout-minutes').not.toBeNull();
  return Number(match![1]);
}

function minutesIn(name: string): number[] {
  return [...jobBlock(name).matchAll(/--minutes\s+(\d+)/g)].map((match) => Number(match[1]));
}

describe('daily enrichment stages', () => {
  it('gives each long-running stage an independent timeout below GitHub maximum', () => {
    const expected: Record<string, number> = {
      'enrich-core': 210,
      descriptions: 300,
      transfers: 120,
      rosters: 300,
      soccerwiki: 120,
      audit: 30,
      enrich: 5,
    };
    for (const [name, timeout] of Object.entries(expected)) {
      expect(jobTimeout(name), name + ' timeout').toBe(timeout);
      expect(jobTimeout(name)).toBeLessThanOrEqual(360);
    }
  });

  it('keeps explicit inner time budgets inside their own stage caps', () => {
    const core = minutesIn('enrich-core').reduce((sum, value) => sum + value, 0);
    const soccer = minutesIn('soccerwiki').reduce((sum, value) => sum + value, 0);
    expect(core).toBe(140);
    expect(core).toBeLessThanOrEqual(jobTimeout('enrich-core') - 30);
    expect(soccer).toBe(70);
    expect(soccer).toBeLessThanOrEqual(jobTimeout('soccerwiki') - 30);
  });

  it('preserves the required stage order and a single aggregate result', () => {
    expect(jobBlock('descriptions')).toContain('needs: enrich-core');
    expect(jobBlock('transfers')).toContain('needs: descriptions');
    expect(jobBlock('rosters')).toContain('needs: transfers');
    expect(jobBlock('soccerwiki')).toContain('needs: rosters');
    expect(jobBlock('audit')).toContain('needs: soccerwiki');
    expect(jobBlock('enrich')).toContain('needs: [enrich-core, descriptions, transfers, rosters, soccerwiki, audit]');
    expect(jobBlock('fame')).toContain('needs: enrich');
    expect(jobBlock('watch')).toContain('needs: [enrich, fame]');
  });

  it('uses stage-specific cache keys and passes progress forward', () => {
    expect(jobBlock('enrich-core')).toContain('scraper-cache-${{ github.run_id }}-${{ github.run_attempt }}-core');
    expect(jobBlock('descriptions')).toContain('scraper-cache-${{ github.run_id }}-${{ github.run_attempt }}-descriptions');
    expect(jobBlock('descriptions')).toContain('scraper-cache-${{ github.run_id }}-${{ github.run_attempt }}-core');
    expect(jobBlock('transfers')).toContain('scraper-cache-${{ github.run_id }}-${{ github.run_attempt }}-transfers');
    expect(jobBlock('rosters')).toContain('scraper-cache-${{ github.run_id }}-${{ github.run_attempt }}-rosters');
    expect(jobBlock('soccerwiki')).toContain('scraper-cache-${{ github.run_id }}-${{ github.run_attempt }}-soccerwiki');
  });
});
