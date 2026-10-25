import { test, expect } from '@playwright/test';
import { STUB_PORT, STUB_SECRET } from './ws-stub';

// Smoke: /preview loads the schema from the stub and renders the interactive UI. Proves the
// preview route boots through GrasshopperSource + the Solve Session, and that the initial
// solve path doesn't error — the change that needed live verification.

const SESSION = 'e2e-session';

test.describe('/preview', () => {
	test('connects to the stub and renders the input UI', async ({ page }) => {
		await page.goto(`/preview?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);

		await expect(page.getByRole('button', { name: 'Interactive Preview' })).toBeVisible();

		// Loading clears once initialData arrives.
		await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });

		// No error state — the initial solve seeding must not surface an error.
		await expect(page.getByText(/No schema configured|Failed to process schema/)).toHaveCount(0);

		// The schema's input renders.
		await expect(page.getByText('Count').first()).toBeVisible();
	});

	test('shows a value list as buttons with the option icon from the schema', async ({ page }) => {
		await page.goto(`/preview?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });

		const oak = page.getByRole('radio', { name: 'Oak' });
		await expect(oak).toBeVisible();
		await expect(oak.locator('svg path')).toHaveAttribute('d', 'M3 21V8l9-5 9 5v13');
		await expect(page.getByRole('radio', { name: 'Larch' }).locator('svg')).toHaveCount(0);
	});
});
