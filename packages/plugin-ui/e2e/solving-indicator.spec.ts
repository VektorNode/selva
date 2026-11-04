import { test, expect, type Page } from '@playwright/test';
import { SLOW_SOLVE_COUNT, STUB_PORT, STUB_SECRET } from './ws-stub';

const SESSION = 'e2e-session';

// The chip's text, not its status region: the region has no box of its own, so it never counts
// as visible.
const solvingChip = (page: Page) => page.getByText(/Solving/);

async function startSlowSolve(page: Page, hostQuery: string) {
	await page.goto(`/preview?session=${SESSION}&wsPort=${STUB_PORT}${hostQuery}#s=${STUB_SECRET}`);
	await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });

	const count = page.getByRole('spinbutton').first();
	await count.fill(String(SLOW_SOLVE_COUNT));
	await count.blur();
}

// The indicator is where the page says Esc aborts; a slow solve must show it and then clear it.
test.describe('solving indicator', () => {
	test('shows through a slow solve in the Rhino panel', async ({ page }) => {
		await startSlowSolve(page, '&host=rhino');

		await expect(solvingChip(page)).toBeVisible();
		await expect(solvingChip(page)).toBeHidden({ timeout: 5_000 });
	});

	test('shows through a slow solve in a browser tab', async ({ page }) => {
		await startSlowSolve(page, '');

		await expect(solvingChip(page)).toBeVisible();
		await expect(solvingChip(page)).toBeHidden({ timeout: 5_000 });
	});
});
