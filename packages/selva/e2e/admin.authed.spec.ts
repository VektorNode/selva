import { expect, test } from '@playwright/test';

// Authed flows — reuse the admin session minted by the `setup` project
// (storageState wired in playwright.config.ts). These confirm the session
// cookie is honoured and admin-only surfaces render.

test('admin dashboard loads for an authenticated admin', async ({ page }) => {
	await page.goto('/admin');

	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

	// instance_admin sees the compute admin tile.
	await expect(page.locator('a[href="/admin/compute"]').first()).toBeVisible();
});

test('compute admin page is reachable', async ({ page }) => {
	await page.goto('/admin/compute');

	// Not bounced to /login — the admin session carries through.
	await expect(page).toHaveURL(/\/admin\/compute$/);
});
