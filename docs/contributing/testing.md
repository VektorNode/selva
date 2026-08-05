# Testing

| Layer              | Tool       | Where                                | Command                                 |
| ------------------ | ---------- | ------------------------------------ | --------------------------------------- |
| Unit / integration | Vitest     | `packages/*/src/**/*.{test,spec}.ts` | `pnpm test`                             |
| End-to-end         | Playwright | `packages/selva/e2e/`                | `pnpm test:e2e --filter=@selvajs/selva` |

## Vitest

`pnpm test` runs `vitest run` per package via turbo. Tests import workspace source directly through the `"selva-source"` export condition — no upstream rebuild needed.

The selva suite is serial (`fileParallelism: false`): each test owns a tmpdir and the global provider holder must stay unambiguous.

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
