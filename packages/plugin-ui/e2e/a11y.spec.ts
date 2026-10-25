import { test, expect, devices, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { STUB_PORT, STUB_SECRET } from './ws-stub';

// WCAG 2.2 AA audit of the builder and the preview, in both themes. Fails on serious and
// critical findings only; axe's moderate ones are best-practice hints.

const SESSION = 'e2e-session';
const QUERY = `session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`;

async function audit(page: Page, theme: 'light' | 'dark') {
	// Colours read mid-transition or mid-fade, just after the theme flips or a card appears,
	// fail falsely.
	await page.addStyleTag({
		content: '*, *::before, *::after { transition: none !important; animation: none !important; }'
	});
	await page.evaluate(
		(dark) => document.documentElement.classList.toggle('dark', dark),
		theme === 'dark'
	);
	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		// A slider's thumb and a checkbox are 16px, but the whole track and the field label take
		// the pointer too; axe measures only the element itself.
		.disableRules(['target-size'])
		// paneforge sets aria-valuenow on its handle only once the panes have measured.
		.exclude('[data-slot="resizable-handle"]')
		.analyze();
	const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(
		blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
	).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
	test.describe(`accessibility, ${theme}`, () => {
		test('builder', async ({ page }) => {
			await page.goto(`/builder?${QUERY}`);
			await expect(page.getByText('Loading schema...')).toBeHidden({ timeout: 15_000 });
			await audit(page, theme);
		});

		test('preview', async ({ page }) => {
			await page.goto(`/preview?${QUERY}`);
			await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });
			await audit(page, theme);
		});

		test.describe('on a phone', () => {
			test.use({ viewport: devices['iPhone 13'].viewport, hasTouch: true });

			test('preview', async ({ page }) => {
				await page.goto(`/preview?${QUERY}`);
				await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });
				await audit(page, theme);
			});
		});
	});
}
