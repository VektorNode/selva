import { test, expect } from '@playwright/test';

// Smoke: /builder loads a schema from the WebSocket stub and renders the editor. Proves the
// route boots, GrasshopperSource connects to :8765, requestInitialData round-trips, and the
// builder paints — without a live Grasshopper.

const SESSION = 'e2e-session';

test.describe('/builder', () => {
	test('connects to the stub and renders the schema editor', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}`);

		// Title chrome from AppShell.
		await expect(page.getByRole('button', { name: 'Schema Builder' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Interactive Preview' })).toBeVisible();

		// The loading state must clear once initialData arrives from the stub.
		await expect(page.getByText('Loading schema...')).toBeHidden({ timeout: 15_000 });

		// The editor painted: the save action and the stub schema's tab ("Main") are present.
		await expect(page.getByRole('button', { name: /Save Schema/ })).toBeVisible();
		await expect(page.getByText('Main').first()).toBeVisible({ timeout: 10_000 });
	});

	test('saves the schema through the stub', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}`);
		await expect(page.getByText('Loading schema...')).toBeHidden({ timeout: 15_000 });

		await page.getByRole('button', { name: /Save Schema/ }).click();

		// The stub acks with schemaSaved -> success toast.
		await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 10_000 });
	});
});
