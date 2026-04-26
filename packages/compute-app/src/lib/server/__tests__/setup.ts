/**
 * Global vitest setup file. Mocks `$lib/server/providers.server` so every
 * route handler and access helper imports a forwarding stub that reads from
 * `currentTestProviders()` instead of the production singleton initialized
 * from selva.config.ts + process.env.
 *
 * Wired via `test.setupFiles` in vitest.config.ts — runs once per test file
 * before any test code executes. The mock is hoisted above this file's
 * imports by vitest, so the factory can only reference top-level imports
 * and the test-providers module.
 */

import { vi } from 'vitest';

vi.mock('$lib/server/providers.server', async () => {
	const { currentTestProviders } = await import('./test-providers.js');
	return {
		get providers() {
			return currentTestProviders().config;
		},
		get tenancy() {
			return currentTestProviders().tenancy;
		},
		get flags() {
			return currentTestProviders().flags;
		},
		get definitionService() {
			return currentTestProviders().definitionService;
		},
		flag: (name: string) =>
			Boolean((currentTestProviders().flags as Record<string, unknown>)[name]),
		getAuthProvider: () => currentTestProviders().config.auth,
		getStorageProvider: () => currentTestProviders().config.storage,
		getOrganizationProvider: () => currentTestProviders().config.data.orgs,
		getProjectProvider: () => currentTestProviders().config.data.projects,
		getDefinitionMeta: () => currentTestProviders().config.data.definitions,
		getComputeServerConfigStore: () => currentTestProviders().config.data.computeServer,
		getUserProfileStore: () => currentTestProviders().config.userProfile,
		getInviteStore: () => currentTestProviders().config.data.invites,
		getPermissionStore: () => currentTestProviders().config.permissions
	};
});
