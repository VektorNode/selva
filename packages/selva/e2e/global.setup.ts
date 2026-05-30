import { expect, test as setup } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ADMIN } from '../playwright.config';

// Provisions the admin session that authed specs reuse. Runs as its own
// Playwright project (no storageState) before the `authed` project.
//
// The flow is idempotent across server reuse:
//   • Fresh DATA_PATH → `/setup` renders the create-admin form; we fill it,
//     submit, and land on /admin with a session cookie.
//   • Server already has an admin (e.g. `reuseExistingServer` locally) →
//     `/setup` redirects to `/login`; we sign in with the same credentials.
// Either way we end authenticated, then persist storageState.

setup('authenticate as admin', async ({ page }) => {
	await page.goto('/setup');

	if (new URL(page.url()).pathname === '/setup') {
		// Fresh instance — create the admin.
		await page.getByLabel('Company name').fill(ADMIN.company);
		await page.getByLabel('Display name').fill(ADMIN.displayName);
		await page.getByLabel('Email').fill(ADMIN.email);
		await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
		await page.getByLabel('Confirm Password').fill(ADMIN.password);
		await page.getByRole('button', { name: /create account/i }).click();
	} else {
		// Admin already exists — sign in instead.
		await page.goto('/login');
		await page.getByLabel('Email').fill(ADMIN.email);
		await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
		await page.getByRole('button', { name: /sign in with password/i }).click();
	}

	// Success leaves the auth page: setup → /admin, login → /library. Either
	// way we're authenticated; confirm by reaching /admin directly.
	await page.waitForURL((url) => !/\/(setup|login)$/.test(url.pathname));
	await page.goto('/admin');
	await expect(page).toHaveURL(/\/admin$/);

	fs.mkdirSync(path.dirname(ADMIN.stateFile), { recursive: true });
	await page.context().storageState({ path: ADMIN.stateFile });
});
