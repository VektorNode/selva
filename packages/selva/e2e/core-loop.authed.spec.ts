import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { meshCountForInput, startFakeCompute, type FakeCompute } from './helpers/fake-compute';

// The product's core loop, end to end in a real browser:
//
//   authed admin → register compute server → upload a .gh through the real dialog
//   (schema-extraction gate included) → open /library/{guid} → solve → binary SLVA
//   geometry decoded by the shipping JS parser → three.js render → slider change
//   re-solves and the geometry demonstrably tracks the input.
//
// By default compute is faked at the HTTP transport seam (helpers/fake-compute.ts),
// so the suite is hermetic and CI-able. Point E2E_COMPUTE_URL (+ E2E_COMPUTE_KEY)
// at a live Rhino.Compute (VektorNode fork) to run the same flow for real — the
// fixture .gh is a genuine UI Builder definition, so the schema gate passes there too.
//
// "Rendered" is asserted through the page's own per-solve telemetry line
// (`[Compute/browser] … mesh=<ms>ms (<count>)`), which reports how many meshes the
// binary parser produced, plus a visible, non-zero-sized viewer canvas.

const GH_FIXTURE = fileURLToPath(new URL('./fixtures/bench-display.gh', import.meta.url));

const REAL_COMPUTE_URL = process.env.E2E_COMPUTE_URL ?? process.env.RHINO_COMPUTE_URL;
const REAL_COMPUTE_KEY = process.env.E2E_COMPUTE_KEY ?? process.env.RHINO_COMPUTE_KEY;

let fake: FakeCompute | null = null;

test.beforeAll(async () => {
	if (!REAL_COMPUTE_URL) fake = await startFakeCompute();
});

test.afterAll(async () => {
	await fake?.close();
	fake = null;
});

function isSolveResponse(url: string, method: string): boolean {
	return method === 'POST' && new URL(url).pathname === '/api/v1/compute';
}

function collectMeshCounts(page: Page): number[] {
	const counts: number[] = [];
	page.on('console', (msg) => {
		const m = msg.text().match(/mesh=\d+ms \((\d+)\)/);
		if (m) counts.push(Number(m[1]));
	});
	return counts;
}

test('core loop: upload → solve → binary geometry renders and tracks input', async ({
	page,
	request
}) => {
	// Real solves ship multi-MB payloads; give the whole loop room.
	test.setTimeout(240_000);

	// -- Register the compute server (fake by default, live via env) -----------
	const put = await request.put('/admin/api/compute', {
		data: {
			defaultServerId: 'e2e-compute',
			servers: [
				{
					id: 'e2e-compute',
					label: 'E2E compute',
					serverUrl: REAL_COMPUTE_URL ?? fake!.url,
					sharedWith: 'all',
					...(REAL_COMPUTE_KEY ? { apiKey: REAL_COMPUTE_KEY } : {})
				}
			]
		}
	});
	expect(put.status(), await put.text().catch(() => '')).toBe(204);

	// -- Upload through the real dialog (schema gate runs against compute) -----
	await page.goto('/projects');
	await page.getByRole('button', { name: /add definition/i }).click();
	await page.locator('#new-file').setInputFiles(GH_FIXTURE);
	// Validation succeeded once the display name is pre-filled from the extracted
	// schema — the submit button stays inert until then.
	await expect(page.locator('#new-dn')).toHaveValue(/bench test display/i, { timeout: 60_000 });

	const uploadResponse = page.waitForResponse(
		(r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/definitions'
	);
	await page.getByRole('button', { name: /^create definition$/i }).click();
	const uploaded = await uploadResponse;
	expect(uploaded.status(), await uploaded.text().catch(() => '')).toBe(201);
	const { guid } = (await uploaded.json()) as { guid: string };
	expect(guid).toBeTruthy();

	// -- Open the app page; first solve (auto, or via Calculate for manual-solve
	//    schemas — the real bench definition ships instanceSolve: false) --------
	const meshCounts = collectMeshCounts(page);
	const firstSolve = page.waitForResponse((r) => isSolveResponse(r.url(), r.request().method()), {
		timeout: 180_000
	});
	await page.goto(`/library/${guid}`);
	await page
		.getByRole('button', { name: /press to calculate/i })
		.click({ timeout: 10_000 })
		.catch(() => {}); // auto-solve schemas render no button — the solve is already in flight
	const solved = await firstSolve;
	expect(solved.status(), await solved.text().catch(() => '')).toBe(200);

	// -- Binary geometry rendered ----------------------------------------------
	const canvas = page.locator('canvas').first();
	await expect(canvas).toBeVisible({ timeout: 60_000 });
	const box = await canvas.boundingBox();
	expect(box?.width ?? 0).toBeGreaterThan(0);
	expect(box?.height ?? 0).toBeGreaterThan(0);

	await expect.poll(() => meshCounts.length, { timeout: 60_000 }).toBeGreaterThan(0);
	const firstMeshCount = meshCounts[meshCounts.length - 1];
	expect(firstMeshCount).toBeGreaterThan(0);

	// -- Slider change re-solves and geometry tracks the input ------------------
	// `End` snaps the Count slider (min 50) to its max of 100; the commit is
	// debounced 150ms, then the session throttles into a fresh POST /api/compute.
	const countsBeforeChange = meshCounts.length;
	const nextSolve = page.waitForResponse((r) => isSolveResponse(r.url(), r.request().method()), {
		timeout: 180_000
	});
	const countSlider = page.getByRole('slider').first();
	await countSlider.focus();
	await countSlider.press('End');
	// Manual-solve schemas (instanceSolve: false — the real bench definition) arm a
	// "Calculate" button on change instead of auto-solving; press it when it appears.
	await page
		.getByRole('button', { name: /^calculate$/i })
		.click({ timeout: 10_000 })
		.catch(() => {}); // auto-solve schemas: the change already dispatched the solve
	const resolved = await nextSolve;
	expect(resolved.status(), await resolved.text().catch(() => '')).toBe(200);

	await expect
		.poll(() => meshCounts.length, { timeout: 60_000 })
		.toBeGreaterThan(countsBeforeChange);

	if (fake) {
		// The fake maps Count → mesh count (100 → 4), so a changed render count
		// proves the input value crossed browser → server → compute → parser.
		await expect
			.poll(() => meshCounts[meshCounts.length - 1], { timeout: 60_000 })
			.toBe(meshCountForInput(100));
		expect(fake.solveInputs[fake.solveInputs.length - 1]).toBe(100);
	} else {
		// Live compute: assert the second solve still produced renderable meshes.
		await expect
			.poll(() => meshCounts[meshCounts.length - 1], { timeout: 60_000 })
			.toBeGreaterThan(0);
	}
});
