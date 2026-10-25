import { test, expect } from '@playwright/test';
import { STUB_PORT, STUB_SECRET } from './ws-stub';

// Smoke: /builder loads a schema from the WebSocket stub and renders the editor. Proves the
// route boots, GrasshopperSource connects to the stub, requestInitialData round-trips, and the
// builder paints — without a live Grasshopper.

const SESSION = 'e2e-session';

test.describe('/builder', () => {
	test('connects to the stub and renders the schema editor', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);

		// Title chrome from AppShell.
		await expect(page.getByRole('button', { name: 'Schema Builder' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Interactive Preview' })).toBeVisible();

		// The loading state must clear once initialData arrives from the stub.
		await expect(page.getByText('Loading schema...')).toBeHidden({ timeout: 15_000 });

		// The editor painted: the save action and the stub schema's tab ("Main") are present.
		await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
		await expect(page.getByText('Main').first()).toBeVisible({ timeout: 10_000 });
	});

	test('drops the secret from the address bar and still reconnects after a reload', async ({
		page
	}) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await expect(page.getByText('Main').first()).toBeVisible({ timeout: 15_000 });
		await expect(page).not.toHaveURL(/#s=/);

		await page.reload();
		await expect(page.getByText('Main').first()).toBeVisible({ timeout: 15_000 });
	});

	test('saves the schema through the stub', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await expect(page.getByText('Loading schema...')).toBeHidden({ timeout: 15_000 });

		await page.getByRole('button', { name: 'Save', exact: true }).click();

		// The stub acks with schemaSaved -> success toast.
		await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 10_000 });
	});

	test('refuses to connect without the secret from Grasshopper', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}`);
		await expect(page.getByText(/Open this page from Grasshopper/)).toBeVisible({
			timeout: 15_000
		});
	});

	test('reports a link the plugin refused', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=stale`);
		await expect(page.getByText(/Grasshopper refused this link/)).toBeVisible({ timeout: 15_000 });
	});

	test('gives a value-list option an icon from the bundled set', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await expect(page.getByText('Loading schema...')).toBeHidden({ timeout: 15_000 });

		const card = page.locator('[data-builder-item-id="item-2"]');
		await card.getByRole('button', { name: 'Expand details' }).click();
		await card.getByRole('button', { name: 'Advanced' }).click();
		await expect(card.getByRole('button', { name: 'Buttons' })).toHaveClass(/bg-primary/);

		await card.getByRole('button', { name: 'Icon for Larch' }).click();
		await page.getByRole('textbox', { name: 'Search icons' }).fill('trees');
		await page.getByRole('button', { name: 'trees', exact: true }).click();

		await expect(
			card.getByRole('button', { name: 'Icon for Larch' }).locator('svg path')
		).toHaveAttribute('d', /.+/);
		await expect(
			card.getByRole('button', { name: 'Remove icon and image from Larch' })
		).toBeVisible();
	});
});
