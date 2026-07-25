# Testing

The test harness is grown outward from the game-logic core. This is the
bootstrap layer: a real, runnable pipeline plus the first regression tests. The
full target is described in the prompt (`Aloews/full` → `prompts/`).

## Frontend (TypeScript / Vitest)

```bash
npm test            # unit + property + data-integrity, once
npm run test:watch  # watch mode
npm run test:cov    # + coverage gate (line ≥90 / branch ≥85 on the core)
npm run test:mutation   # StrykerJS mutation testing on the game-logic core
```

Layout:
- `test/data-integrity/` — invariants over the real `sherlock_cards.csv`.
- `src/**/*.test.ts` — unit + property tests colocated with the code.

`test:cov` gates coverage on `src/features/game/stateMachine.ts` and
`src/shared/lib/tier.ts` (currently 100%). Widen `coverage.include` in
`vitest.config.ts` as tests spread to more modules.

`test:mutation` is scoped (via `stryker.conf.json` → `mutate`) to the same core;
it breaks the build below an 80% mutation score. Current score: **96.92%** (the
two survivors are equivalent mutants on the `import.meta.env.DEV` dev-log guard,
which is always true under test and therefore unkillable). The HTML report lands
in `reports/mutation/`.

## Scraper (Python / pytest + Hypothesis)

```bash
cd football_scraper
pip install -r requirements.txt
python -m pytest -q          # property-based dedup tests
```

`tests/test_property_canonical.py` fuzzes `canonical_key()` — the guard that
stops one player being inserted twice under a different spelling. The older
`tests/test_*.py` files are self-running scripts (`python -m tests.test_dedup`).

Mutation testing (config in `football_scraper/setup.cfg`):

```bash
cd football_scraper && mutmut run
```

## Reading a mutation report

A *survived* mutant is a change to the production code that no test noticed — a
hole in the suite, not a bug in the code. Kill it by adding an assertion that
distinguishes the mutated behaviour from the real one. Only equivalent mutants
(changes that can't alter observable behaviour) are allowed to survive, and they
must be justified.

## Known defects locked by tests

See `test/data-integrity/cards.test.ts` — the `it.fails()` blocks assert that a
real defect is still present, and flip to failing (demanding attention) the
moment the data is corrected. Do not delete them; fix the data and convert them
to normal assertions.
