/**
 * Drift guard for the `$lib/server/providers.server` mock in setup.ts.
 *
 * That mock is a hand-maintained mirror of the real module's export surface;
 * every time someone adds an export, the mock silently rots until some test
 * happens to call the missing function mid-suite (see the getTenancy /
 * getDefinitionService breakage). This test makes the next drift fail loudly,
 * up front, with the offending names.
 *
 * It asserts the mock's keys are a SUPERSET of the real module's runtime
 * exports — extra mock-only keys are fine, missing ones are not.
 */

import { describe, it, expect, vi } from 'vitest';
import { freshProviders, type TestProviders } from './fixtures.js';

// Exports that are intentionally NOT mirrored in the mock, with the reason.
// Keep this list short and justified — it is the escape hatch, not the norm.
const INTENTIONALLY_UNMOCKED = new Set<string>([
	// getBranding applies default-filling logic; mocking it would duplicate that
	// logic (itself a drift trap). Tests needing branding exercise the real
	// defaults instead.
	'getBranding'
]);

describe('providers.server mock surface', () => {
	it('mock covers every runtime export of the real module', async () => {
		// Real module — bypass the global vi.mock from setup.ts.
		const real = await vi.importActual<Record<string, unknown>>('$lib/server/providers.server');
		// Mocked module — what setup.ts actually returns. A handle must be set
		// for the forwarding getters to resolve without throwing.
		let tp: TestProviders | null = null;
		try {
			tp = await freshProviders();
			const mocked = await import('$lib/server/providers.server');

			const realKeys = Object.keys(real).filter((k) => !INTENTIONALLY_UNMOCKED.has(k));
			const mockKeys = new Set(Object.keys(mocked));

			const missing = realKeys.filter((k) => !mockKeys.has(k));
			expect(
				missing,
				`Mock in setup.ts is missing exports: ${missing.join(', ')}. ` +
					`Add a forwarding entry (or list it in INTENTIONALLY_UNMOCKED with a reason).`
			).toEqual([]);
		} finally {
			await tp?.cleanup();
		}
	});
});
