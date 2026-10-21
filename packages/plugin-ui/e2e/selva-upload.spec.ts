import { test, expect } from '@playwright/test';
import { STUB_PORT, STUB_SECRET } from './ws-stub';

// The stub answers with the shared wire fixtures: signed in to selva.example.com, a suggestion
// with a version someone else uploaded since, and a successful upload.

const SESSION = 'e2e-session';

test.describe('Upload to Selva', () => {
	test('uploads a new version of the suggested definition', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await page.getByRole('button', { name: 'Upload to Selva' }).click();

		const dialog = page.getByRole('dialog', { name: 'Upload to Selva' });
		await expect(dialog.getByText('ada@example.com')).toBeVisible({ timeout: 10_000 });
		await expect(dialog.getByText('selva.example.com')).toBeVisible();

		await expect(
			dialog.getByRole('radio', { name: /New version of Facade panel in Tower/ })
		).toBeChecked();
		await expect(dialog.getByText(/Someone else uploaded version 4/)).toBeVisible();
		await expect(dialog.getByRole('switch', { name: 'Make live' })).not.toBeChecked();

		await dialog.getByRole('button', { name: 'Upload', exact: true }).click();

		await expect(dialog.getByText('Uploaded Facade panel, version 5')).toBeVisible();
		await expect(dialog.getByText(/It's the draft/)).toBeVisible();
		await expect(dialog.getByRole('link', { name: 'Open in Selva' })).toHaveAttribute(
			'href',
			'https://selva.example.com/library/44444444-4444-4444-8444-444444444444'
		);
	});

	test('waits for unsaved schema edits to be saved', async ({ page }) => {
		await page.goto(`/builder?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		const upload = page.getByRole('button', { name: 'Upload to Selva' });
		await expect(upload).toBeEnabled({ timeout: 15_000 });

		await page.locator('input[type="number"]').first().fill('3');
		await expect(upload).toBeDisabled();
		await expect(page.getByTitle('Save the schema first')).toBeVisible();
	});
});
