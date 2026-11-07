import { test, expect, type Page } from '@playwright/test';
import { SLOW_SOLVE_COUNT, STUB_PORT, STUB_SECRET } from './ws-stub';

// Smoke: /preview loads the schema from the stub and renders the interactive UI. Proves the
// preview route boots through GrasshopperSource + the Solve Session, and that the initial
// solve path doesn't error — the change that needed live verification.

const SESSION = 'e2e-session';

type Frame = { type?: string; isSolving?: boolean; outputs?: Record<string, unknown> };

/** Every JSON frame the page sends and receives, in order. */
function recordFrames(page: Page): { sent: Frame[]; received: Frame[] } {
	const frames = { sent: [] as Frame[], received: [] as Frame[] };
	const parse = (payload: string | Buffer): Frame | null =>
		typeof payload === 'string' ? (JSON.parse(payload) as Frame) : null;
	page.on('websocket', (ws) => {
		ws.on('framesent', (frame) => {
			const message = parse(frame.payload);
			if (message) frames.sent.push(message);
		});
		ws.on('framereceived', (frame) => {
			const message = parse(frame.payload);
			if (message) frames.received.push(message);
		});
	});
	return frames;
}

/**
 * Waits for the solve that produced `area` to close with `solvingState: false`. The page sends
 * anything a solve's result triggers while handling it, so by then a repeat is on the record.
 */
async function solveSettled(received: Frame[], area: number) {
	await expect
		.poll(
			() => {
				const result = received.findIndex((m) => m.outputs?.['out-area'] === area);
				return (
					result >= 0 &&
					received.slice(result).some((m) => m.type === 'solvingState' && m.isSolving === false)
				);
			},
			{ timeout: 10_000 }
		)
		.toBe(true);
}

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

	// How Rhino opens a player session: the start page, with the secret in the fragment. Stripping
	// the fragment from the address bar must not cancel the start page's redirect.
	test('a player opened at the start page lands on the preview', async ({ page }) => {
		await page.goto(`/?session=${SESSION}&wsPort=${STUB_PORT}&mode=player#s=${STUB_SECRET}`);

		await expect(page).toHaveURL(/\/preview\?/);
		await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });
		await expect(page.getByText('Count').first()).toBeVisible();
	});

	// Each request makes the plugin serialize and send the whole schema.
	test('asks for initial data once', async ({ page }) => {
		const { sent, received } = recordFrames(page);

		await page.goto(`/preview?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });
		// A second request would go out on connect, long before the first solve comes back.
		await solveSettled(received, 3 * 3);

		expect(sent.filter((m) => m.type === 'requestInitialData')).toHaveLength(1);
	});

	// The field reports on input and again on blur; the repeat would be a second solve.
	test('sends an edited value once', async ({ page }) => {
		const { sent, received } = recordFrames(page);
		const updates = () => sent.filter((m) => m.type === 'valueUpdate');

		await page.goto(`/preview?session=${SESSION}&wsPort=${STUB_PORT}#s=${STUB_SECRET}`);
		await expect(page.getByText('Loading preview...')).toBeHidden({ timeout: 15_000 });
		await solveSettled(received, 3 * 3);
		const before = updates().length;

		const count = page.getByRole('spinbutton').first();
		await count.fill(String(SLOW_SOLVE_COUNT));
		await count.blur();
		await solveSettled(received, SLOW_SOLVE_COUNT * SLOW_SOLVE_COUNT);

		expect(updates().slice(before)).toHaveLength(1);
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
