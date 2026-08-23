import { expect, test as setup } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ADMIN } from '../playwright.config';

// Provisions the admin session that authed specs reuse. Runs as its own
// Playwright project (no storageState) before the `authed` project.
//
// Idempotent across server reuse: a fresh DATA_PATH lands on the create-admin
// form at /setup; a server that already has an admin (e.g. `reuseExistingServer`
// locally) redirects /setup to /login instead, so we sign in with the same
// credentials. Either way we end authenticated, then persist storageState.

setup('authenticate as admin', async ({ page }) => {
	await page.goto('/setup');

	if (new URL(page.url()).pathname === '/setup') {
		await page.getByLabel('Company name').fill(ADMIN.company);
		await page.getByLabel('Display name').fill(ADMIN.displayName);
		await page.getByLabel('Email').fill(ADMIN.email);
		await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
		await page.getByLabel('Confirm Password').fill(ADMIN.password);
		await page.getByRole('button', { name: /create account/i }).click();
	} else {
		await page.goto('/login');
		await page.getByLabel('Email').fill(ADMIN.email);
		await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
		await page.getByRole('button', { name: /sign in with password/i }).click();
	}

	// setup redirects to /admin, login redirects to /library — either way we're
	// authenticated; confirm by reaching /admin directly.
	await page.waitForURL((url) => !/\/(setup|login)$/.test(url.pathname));
	await page.goto('/admin');
	await expect(page).toHaveURL(/\/admin$/);

	fs.mkdirSync(path.dirname(ADMIN.stateFile), { recursive: true });
	await page.context().storageState({ path: ADMIN.stateFile });
});
