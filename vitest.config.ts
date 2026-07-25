import { defineConfig } from 'vitest/config';
import path from 'path';

// Test harness for the frontend. Runs in a Node environment (the current suite
// covers pure logic + data integrity, no DOM). Coverage is gated in CI on the
// game/lib/store cores — see .github/workflows/ci.yml.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // Core logic we hold to a high bar. Everything else is reported but not
      // yet gated — the harness is being grown outward from the core.
      include: [
        'src/features/game/stateMachine.ts',
        'src/shared/lib/tier.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
