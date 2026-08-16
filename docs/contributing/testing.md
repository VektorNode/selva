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

`*.spec.ts` is reserved for Playwright, so the two never collide — the shared vitest
config excludes `**/e2e/**` and Playwright only collects from `e2e/`.

Shared fixtures and harness that several suites import go in a package-level
`tests/` directory (`tests/setup.ts`, `tests/helpers/`). Only put a `.test.ts`
there when it isn't testing one module — `@selvajs/compute`'s
`tests/contract/` holds seam tests against a recorded server snapshot.

Benchmarks live beside the tests as `*.bench.ts`. `pnpm test` never runs them;
they're on-demand via a package's `bench` script (`@selvajs/visualization` and
`@selvajs/compute` have one). They record a baseline for the costs that scale
with mesh size — edge extraction and mesh-batch parsing — so a regression is
measurable rather than remembered.

## Vitest config

Every package's `vitest.config.ts` starts from the shared base:

```ts
import { createVitestConfig } from '@selvajs/config/vitest';

export default createVitestConfig();
```

The base carries only rules that fail _silently_ when a package forgets them:
the `selva-source` condition (so tests read workspace TypeScript source, no
upstream rebuild), and excludes for `**/dist/**` (tsc emits test files there;
without it every suite runs twice against stale output) and `**/e2e/**`.

Pass an override object for anything package-specific — setup files, path
aliases, plugins, timeouts. Keep the reason in a comment next to it; a setting
nobody can justify is one nobody can safely delete later.

**Don't add `isolate: false`.** Several suites use `vi.mock()`. With a shared
module graph, whichever file imports the target first wins and the mock silently
never applies — order-dependent, so it passes locally and fails in CI. The
speedup is a fraction of a second; the failure mode costs an afternoon.

Two suites run serially, both because they share mutable state: `@selvajs/selva`
(the global provider holder) and `@selvajs/supabase-provider` (one local
Postgres, reset in `beforeEach`).

## Providers implement a conformance kit

`@selvajs/platform` defines the provider interfaces; each implementation proves
it satisfies them with a `*-conformance.test.ts` per interface
(`packages/providers/local/src/data/__tests__/`, and the Supabase mirror). A new
provider is expected to run the same kit rather than invent its own coverage —
that's what keeps the implementations swappable.

Supabase's conformance suites need a live local stack (`npx supabase start`).
Without one they skip with a single warning instead of failing per test.

## Exception: `@selvajs/cli`

The CLI uses `node --test`, not vitest. It scaffolds the deployment that
installs the runtime, so it can't depend on workspace packages — including the
test tooling. It stays out of the shared config on purpose.

## Playwright

E2E covers `@selvajs/selva` only. The plugin UI requires a live Grasshopper WebSocket and can't run in CI.

Playwright's `webServer` serves the production `node build/index.js` (adapter-node). Running through turbo (`pnpm test:e2e`) builds first; running `playwright test` directly assumes `build/` is current.

The server uses the local provider with throwaway secrets and a temp `DATA_PATH` under `.e2e/`. Nothing reads your real `.env`.

### Projects (run in order)

1. **`setup`** — runs `global.setup.ts`, creates an admin via `/setup`, persists session to `e2e/.auth/admin.json`.
2. **`smoke`** — unauthenticated surface (landing, login, protected-route redirect).
3. **`authed`** — reuses the admin session; spec files named `*.authed.spec.ts`; depends on `setup`.

### Running locally

```bash
# First run — install browser
pnpm --filter @selvajs/selva exec playwright install chromium

# Build + run via turbo
pnpm test:e2e --filter=@selvajs/selva

# Inside the package
pnpm exec playwright test --project=smoke
pnpm exec playwright test --ui
```

For a clean slate, delete `packages/selva/.e2e` and `packages/selva/e2e/.auth`.

### Adding an authed test

Name the file `*.authed.spec.ts` — inherits the admin session automatically:

```ts
import { expect, test } from '@playwright/test';

test('does an admin thing', async ({ page }) => {
	await page.goto('/admin/whatever');
	await expect(page).toHaveURL(/\/admin\/whatever$/);
});
```

For flows that hit Rhino.Compute, stub the response with `page.route` — CI has no compute backend.
