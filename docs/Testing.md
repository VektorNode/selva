# Testing

Two layers, run separately:

| Layer                | Tool       | Where                                | Command                                 |
| -------------------- | ---------- | ------------------------------------ | --------------------------------------- |
| Unit / integration   | Vitest     | `packages/*/src/**/*.{test,spec}.ts` | `pnpm test`                             |
| End-to-end (browser) | Playwright | `packages/selva/e2e/`                | `pnpm test:e2e --filter=@selvajs/selva` |

The unit layer is fast and runs across every package; it never loads a browser. The E2E layer drives the real `@selvajs/selva` app in Chromium and is scoped to that package only.

## Unit / integration (Vitest)

`pnpm test` runs `vitest run` per package via turbo. Tests read workspace-package **source** directly through the `"source"` export condition (see [packages/selva/vitest.config.ts](../packages/selva/vitest.config.ts)), so editing a rule and re-running tests needs no upstream rebuild.

The selva suite is serial (`fileParallelism: false`, single fork): each test owns a tmpdir and the global provider holder must stay unambiguous. Server-side `$env/dynamic/private` and SvelteKit virtual modules are aliased to stubs under `src/lib/server/__tests__/`.

## End-to-end (Playwright)

E2E only covers `@selvajs/selva` — the cloud app. The plugin UI is excluded: it depends on a live WebSocket to a running Grasshopper instance, which can't be driven in CI.

### How it runs

Playwright's `webServer` builds nothing itself — it serves the production `node build/index.js` (adapter-node), the same entrypoint a deployment uses. The turbo `test:e2e` task depends on `build`, so running it through turbo (the root `pnpm test:e2e` script) builds the app first. Running `playwright test` directly assumes `build/` is already current.

The server boots with the **local provider** and throwaway secrets, pointed at a temp `DATA_PATH` under `.e2e/` (gitignored). Local is the only stack with no external dependency — no Rhino.Compute, no Supabase. All of this is wired in [packages/selva/playwright.config.ts](../packages/selva/playwright.config.ts); nothing reads your real `.env`.

### Projects

Three Playwright projects, run in this order:

- **`setup`** — drives the real `/setup` form once to create an admin (or signs in if one already exists), then persists the session to `e2e/.auth/admin.json`. Idempotent across server reuse. See [e2e/global.setup.ts](../packages/selva/e2e/global.setup.ts).
- **`smoke`** — unauthenticated public surface (landing, login, protected-route redirect). No stored session. See [e2e/smoke.spec.ts](../packages/selva/e2e/smoke.spec.ts).
- **`authed`** — reuses the admin session via `storageState`; `dependsOn: ['setup']`. Spec files are named `*.authed.spec.ts`. See [e2e/admin.authed.spec.ts](../packages/selva/e2e/admin.authed.spec.ts).

Shared admin credentials are exported as `ADMIN` from `playwright.config.ts` so the setup project and authed specs agree on them.

> **Landing differs by entrypoint.** After auth, the setup-form path redirects to `/admin` but a plain login redirects to `/library`. The setup fixture navigates to `/admin` explicitly afterward rather than asserting a fixed post-auth URL.

### Running locally

```bash
# Build + run everything through turbo (recommended)
pnpm test:e2e --filter=@selvajs/selva

# Inside the package, against an already-built app
cd packages/selva
pnpm test:e2e                      # all projects
pnpm exec playwright test --project=smoke
pnpm exec playwright test --ui     # interactive runner
```

First run needs the browser binary once:

```bash
pnpm --filter @selvajs/selva exec playwright install chromium
```

Locally the server is reused between runs (`reuseExistingServer`), so the `setup` project takes its login branch on the second run. For a clean slate, delete `packages/selva/.e2e` and `packages/selva/e2e/.auth`.

### Adding an authed flow

Name the file `*.authed.spec.ts` and it inherits the admin session automatically — no login boilerplate:

```ts
import { expect, test } from '@playwright/test';

test('does an admin thing', async ({ page }) => {
	await page.goto('/admin/whatever');
	await expect(page).toHaveURL(/\/admin\/whatever$/);
});
```

For flows that hit Rhino.Compute, stub the upstream response (`page.route`) rather than pointing at a live server — CI has no compute backend.

### CI

[.github/workflows/e2e.yml](../.github/workflows/e2e.yml) runs the suite on Linux: it caches the Chromium binary keyed on the Playwright version, installs the browser + OS deps, runs `pnpm test:e2e --filter=@selvajs/selva`, and uploads the HTML report as an artifact. It's a separate workflow from [test.yml](../.github/workflows/test.yml) (the Vitest job) because it needs a build and a browser.
