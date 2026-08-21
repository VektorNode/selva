/**
 * Per-test mutable holder for the provider stack. Lets `freshProviders()` in
 * fixtures.ts swap in a tmpdir-rooted LocalDataProvider for each test, while
 * the `vi.mock` in setup.ts forwards the production `$lib/server/providers.server`
 * import surface to whatever is currently set here.
 *
 * Keep this file free of `vi.*` calls — the mock factory in setup.ts cannot
 * import any module that uses `vi`, since `vi.mock` is hoisted above imports.
 */

import type { SelvaConfig, SelvaFlags, TenancyMode } from '@selvajs/platform';
import type { DefinitionService } from '@selvajs/server/definitions';

export interface TestProviderHandle {
	config: SelvaConfig;
	tenancy: TenancyMode;
	flags: SelvaFlags;
	definitionService: DefinitionService;
}

let _current: TestProviderHandle | null = null;

export function setTestProviders(handle: TestProviderHandle): void {
	_current = handle;
}

export function clearTestProviders(): void {
	_current = null;
}

export function currentTestProviders(): TestProviderHandle {
	if (!_current) {
		throw new Error(
			'No test providers set — call `freshProviders()` in beforeEach (or use `withProviders()`)'
		);
	}
	return _current;
}
