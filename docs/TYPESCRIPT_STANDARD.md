# TypeScript Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md).
> Enforced by `tsc --noEmit` (strict) + ESLint. **MUST** = build/review blocker.

## 1. Strict mode is non-negotiable

`tsconfig.json` MUST keep (or move toward) all strict flags on:

```jsonc
{
  "compilerOptions": {
    "strict": true,                          // implies the below
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,        // arr[i] is T | undefined
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Turning any strict flag **off** is a gate change → needs an ADR.

## 2. `any` is banned

- MUST NOT introduce `any` (explicit or implicit). Use `unknown` at boundaries
  and narrow it.
- MUST NOT use `as` to launder an `any` or to force an incompatible cast. `as` is
  allowed only for genuine narrowing the compiler can't infer, with a comment.
- MUST NOT use `@ts-ignore`/`@ts-expect-error` without a one-line justification
  and, for `@ts-expect-error`, it MUST actually expect an error.
- MUST NOT use non-null `!` to silence `strictNullChecks`. Handle the `null`.

Prefer, at the edges:

```ts
function parse(input: unknown): Card {
  if (!isCard(input)) throw new GameError('bad-card', '…'); // type guard, not `as`
  return input;
}
```

## 3. Model the domain precisely

### Discriminated unions over boolean soup

The codebase already does this well — keep it up.

```ts
// good: illegal combinations are unrepresentable
type CardResult =
  | { status: 'correct'; cardId: string; playerName: string }
  | { status: 'skipped'; cardId: string; playerName: string };

// bad: { isCorrect?: boolean; isSkipped?: boolean } — both true is expressible
```

Exhaustively switch on the discriminant; add a `never` guard so a new variant is
a compile error:

```ts
function points(r: CardResult): number {
  switch (r.status) {
    case 'correct': return 1;
    case 'skipped': return 0;
    default: return assertNever(r);
  }
}
function assertNever(x: never): never { throw new Error(`unhandled: ${x}`); }
```

### Branded types for identifiers

IDs and validated values that share a runtime type (`string`) MUST NOT be
interchangeable at compile time. Brand them:

```ts
type Brand<T, B> = T & { readonly __brand: B };
type CardId  = Brand<string, 'CardId'>;
type RoomId  = Brand<string, 'RoomId'>;
type Pageviews = Brand<number, 'Pageviews'>; // always ≥ 0

// a RoomId can never be passed where a CardId is expected
```

Construct branded values only through validating factory functions.

### `GamePhase` and the state machine

Phases are a string-literal union (`src/shared/types/game.ts`). Any function that
transitions state MUST go through the state machine and MUST be exhaustive over
`GamePhase`.

## 4. Generics

- Use generics to preserve type relationships, not to look clever. If a generic
  has one call site and one type, inline it.
- Constrain type parameters (`<T extends Card>`) rather than leaving them open.
- Prefer inference; annotate only where inference is wrong or a public API needs
  a stable signature.

## 5. API / Supabase typing

- All Supabase reads MUST be typed at the boundary. Generate types from the
  schema (`supabase gen types typescript`) or hand-maintain `shared/types/database.ts`,
  and treat PostgREST/RPC responses as `unknown` until validated/narrowed.
- MUST NOT trust the shape of a network response implicitly. A missing/renamed
  column is a runtime reality (see the graceful-degrade logic in
  `cardRandomizer.ts`) — model it (`T | null`, error codes like `PGRST202`).
- Nullable columns MUST be typed nullable and handled; do not `!` them away.

## 6. Nullability

- `strictNullChecks` + `noUncheckedIndexedAccess` are on. Array access and map
  lookups are `T | undefined` — handle it.
- Prefer early returns / narrowing over deep optional chaining that hides a
  missing-data bug.
- A default value is a decision; make it explicit and, if it affects behaviour,
  test it.

## 7. Style

- `readonly` for data that shouldn't mutate; `as const` for literal tuples/maps.
- `type` for unions/aliases; `interface` for object contracts that may be
  implemented/extended — be consistent within a file.
- No `enum` (prefer `as const` unions); no namespaces; ES modules only.
- Public functions in `shared/` get an explicit return type.

## 8. Review checklist (TS)

- [ ] No new `any` / unjustified `as` / `!` / `@ts-ignore`.
- [ ] Network/edge inputs treated as `unknown` and validated.
- [ ] Unions are discriminated and switched exhaustively (`never` guard).
- [ ] IDs/validated scalars are branded where mixups are plausible.
- [ ] Nullable data is typed nullable and handled.
