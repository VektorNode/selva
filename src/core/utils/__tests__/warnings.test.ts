/**
 * Suite for `warnIfClientSide` (issue 110 — previously untested).
 *
 * The warning must fire in GENUINE browsers (API-key exposure is real there),
 * at most once per function, and must stay silent in Node and in jsdom test
 * environments (jsdom defines `window`, but `process.versions.node` and the
 * jsdom user-agent marker give it away).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warnIfClientSide, resetClientSideWarnings } from '../warnings';
import { setLogger } from '../logger';

const warn = vi.fn();

/** Simulate a genuine browser: window present, no Node process, real-looking UA. */
function stubRealBrowser(): void {
	vi.stubGlobal('window', {});
	vi.stubGlobal('process', undefined);
	vi.stubGlobal('navigator', {
		userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
	});
}

beforeEach(() => {
	warn.mockClear();
	resetClientSideWarnings();
	setLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });
});

afterEach(() => {
	vi.unstubAllGlobals();
	setLogger(null);
});

describe('warnIfClientSide', () => {
	it('does not warn in the Node test environment (tests/setup.ts stubs window={})', () => {
		// This repo's own test setup defines a bare `window` in the node env —
		// the exact false positive issue 110 describes. `process.versions.node`
		// gives Node away.
		expect(typeof window).not.toBe('undefined');
		warnIfClientSide('solveGrasshopperDefinition');
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not warn when window is truly absent', () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('process', undefined);
		warnIfClientSide('solveGrasshopperDefinition');
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not warn under jsdom (window present, but process.versions.node exists)', () => {
		// Real vitest-jsdom runs keep Node's `process` — only `window` is stubbed.
		vi.stubGlobal('window', {});
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (darwin) jsdom/24.0.0' });

		warnIfClientSide('solveGrasshopperDefinition');
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not warn when the user agent carries the jsdom marker even without process', () => {
		vi.stubGlobal('window', {});
		vi.stubGlobal('process', undefined);
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (darwin) jsdom/24.0.0' });

		warnIfClientSide('solveGrasshopperDefinition');
		expect(warn).not.toHaveBeenCalled();
	});

	it('warns in a genuine browser', () => {
		stubRealBrowser();

		warnIfClientSide('solveGrasshopperDefinition');

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('solveGrasshopperDefinition');
	});

	it('warns at most once per function (dedupe)', () => {
		stubRealBrowser();

		warnIfClientSide('solveGrasshopperDefinition');
		warnIfClientSide('solveGrasshopperDefinition');
		warnIfClientSide('solveGrasshopperDefinition');

		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('warns separately for different functions', () => {
		stubRealBrowser();

		warnIfClientSide('solveGrasshopperDefinition');
		warnIfClientSide('fetchDefinitionIO');

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('respects the suppress flag', () => {
		stubRealBrowser();

		warnIfClientSide('solveGrasshopperDefinition', true);
		expect(warn).not.toHaveBeenCalled();
	});

	it('resetClientSideWarnings clears the dedupe', () => {
		stubRealBrowser();

		warnIfClientSide('solveGrasshopperDefinition');
		resetClientSideWarnings();
		warnIfClientSide('solveGrasshopperDefinition');

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('tolerates a missing navigator in a browser-like environment', () => {
		vi.stubGlobal('window', {});
		vi.stubGlobal('process', undefined);
		vi.stubGlobal('navigator', undefined);

		warnIfClientSide('solveGrasshopperDefinition');
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
