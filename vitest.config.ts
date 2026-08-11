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
    // .tsx ТОЖЕ. Раньше маска брала только .test.ts, и это выглядело как
    // «в проекте нет тестов на компоненты» — а на самом деле такой файл
    // молча не собирался: vitest сообщает «No test files found», и решить,
    // что тест не нужен, проще, чем догадаться про маску.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // Core logic we hold to a high bar. Everything else is reported but not
      // yet gated — the harness is being grown outward from the core.
      include: [
        'src/features/game/stateMachine.ts',
        'src/features/game/useTimer.ts',
        'src/shared/lib/tier.ts',
        'src/shared/lib/pro.ts',
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
