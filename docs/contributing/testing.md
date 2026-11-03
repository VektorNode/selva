# Testing

| Layer              | Tool       | Where                                    | Command                                 |
| ------------------ | ---------- | ---------------------------------------- | --------------------------------------- |
| Unit / integration | Vitest     | `packages/*/src/**/__tests__/*.test.ts`  | `pnpm test`                             |
| Benchmarks         | Vitest     | `packages/*/src/**/__tests__/*.bench.ts` | `pnpm --filter <pkg> bench`             |
| End-to-end         | Playwright | `packages/*/e2e/*.spec.ts`               | `pnpm test:e2e --filter=@selvajs/selva` |

## Where tests live

Unit tests sit in a `__tests__/` folder next to the code they cover, named `*.test.ts`:

```
src/compute/rate-limit.ts
src/compute/__tests__/rate-limit.test.ts
```

`*.spec.ts` is reserved for Playwright, so the two never collide: the shared vitest
config excludes `**/e2e/**` and Playwright only collects from `e2e/`.

Setup files and helpers that several suites import go in a package-level `tests/`
directory (`tests/setup.ts`, `tests/helpers/`); fixture placement is in
[STRUCTURE.md](../../STRUCTURE.md#where-fixtures-live). Only put a `.test.ts` there when it
isn't testing one module: `@selvajs/compute`'s `tests/contract/` holds live suites that
self-skip unless `COMPUTE_LIVE_URL` is set (`pnpm test:live`).

Benchmarks live beside the tests as `*.bench.ts`. `pnpm test` never runs them; only
`@selvajs/visualization` has a `bench` script. They baseline the costs that scale with
mesh size (edge extraction and mesh-batch parsing), so a regression is measurable
rather than remembered.

## Vitest config

Every package's `vitest.config.ts` starts from the shared base:

```ts
import { createVitestConfig } from '@selvajs/config/vitest';

export default createVitestConfig();
```

[`packages/config/vitest.config.js`](../../packages/config/vitest.config.js) lists each base
rule and why. The test for belonging there: forgetting it fails _silently_. Anything
package-specific (setup files, aliases, plugins, timeouts) goes in the override object with
a comment giving the reason; a setting nobody can justify is one nobody can safely delete.

**Don't add `isolate: false`.** With a shared module graph, whichever file imports a
`vi.mock()` target first wins and the mock silently never applies. That is
order-dependent, so it passes locally and fails in CI.

Only `@selvajs/supabase-provider` runs files serially (`fileParallelism: false`): its
conformance suites reset one shared local Postgres in `beforeEach`. `@selvajs/selva` uses
`pool: 'forks'` so each file gets its own module registry (the global provider holder is
module state), but files still run in parallel, each in its own temp directory.

## Providers implement a conformance kit

`@selvajs/platform` defines the provider interfaces; each implementation proves
it satisfies them with a `*-conformance.test.ts` per interface
(`packages/providers/local/src/data/__tests__/`, and the Supabase mirror). A new
provider is expected to run the same kit rather than invent its own coverage:
that's what keeps the implementations swappable.

Supabase's conformance suites need a live local stack (`npx supabase start`).
Without one they skip with a single warning instead of failing per test; CI sets
`SELVA_REQUIRE_SUPABASE=1` so a missing stack fails there.

## Exception: `@selvajs/cli`

The CLI uses `node --test`, not vitest. It scaffolds the deployment that
installs the runtime, so it can't depend on workspace packages, including the
test tooling. It stays out of the shared config on purpose.

## Playwright

Two suites, each against a stand-in backend:

- **`@selvajs/selva`**: serves the production `node build/index.js` (adapter-node) on the local provider, with throwaway secrets and a temp `DATA_PATH` under `.e2e/`. Nothing reads your real `.env`. CI runs this suite (`e2e.yml`, `--filter=@selvajs/selva`).
- **`@selvajs/plugin-ui`**: serves the static build with `vite preview` and a WebSocket stub (`e2e/ws-stub.ts`) in place of Grasshopper, so the real transport runs without Rhino. CI does not run it; use `pnpm --filter @selvajs/plugin-ui test:e2e`.

For the selva suite, running through turbo (`pnpm test:e2e`) builds first; running `playwright test` directly assumes `build/` is current.

### Projects (selva)

1. **`setup`**: runs `global.setup.ts`, creates an admin via `/setup`, persists session to `e2e/.auth/admin.json`.
2. **`smoke`**: unauthenticated surface (landing, login, protected-route redirect).
3. **`authed`**: reuses the admin session; spec files named `*.authed.spec.ts`.

Only `authed` depends on `setup`; `smoke` runs independently.

### Running locally

```bash
# First run: install browser
pnpm --filter @selvajs/selva exec playwright install chromium

# Build + run via turbo
pnpm test:e2e --filter=@selvajs/selva

# Inside the package
pnpm exec playwright test --project=smoke
pnpm exec playwright test --ui
```

For a clean slate, delete `packages/selva/.e2e` and `packages/selva/e2e/.auth`.

For flows that hit Rhino.Compute, stub the response with `page.route`: CI has no compute backend.
