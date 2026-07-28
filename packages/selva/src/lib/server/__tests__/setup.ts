/**
 * Global vitest setup file. Mocks `$lib/server/providers.server` so every
 * route handler and access helper imports a forwarding stub that reads from
 * `currentTestProviders()` instead of the production singleton initialized
 * from process.env at module load.
 *
 * Wired via `test.setupFiles` in vitest.config.ts — runs once per test file
 * before any test code executes. The mock is hoisted above this file's
 * imports by vitest, so the factory can only reference top-level imports
 * and the test-providers module.
 */

import { vi } from 'vitest';
import {
	NoopSolveMetricSink,
	NoopErrorReporter,
	NoopEventSink,
	NoopLogger
} from '@selvajs/platform';

vi.mock('$lib/server/providers.server', async () => {
	const { currentTestProviders } = await import('./test-providers.js');
	const { OrgAssetService } = await import('../organizations/OrgAssetService.js');
	// Stable across calls — see `getLogger` below.
	const testLogger = new NoopLogger();
	return {
		get providers() {
			return currentTestProviders().config;
		},
		resolveProviders: () => currentTestProviders().config,
		get tenancy() {
			return currentTestProviders().tenancy;
		},
		getTenancy: () => currentTestProviders().tenancy,
		get flags() {
			return currentTestProviders().flags;
		},
		get definitionService() {
			return currentTestProviders().definitionService;
		},
		getDefinitionService: () => currentTestProviders().definitionService,
		getOrgAssetService: () => {
			const config = currentTestProviders().config;
			return new OrgAssetService(config.data.orgs, config.storage);
		},
		flag: (name: string) =>
			Boolean((currentTestProviders().flags as Record<string, unknown>)[name]),
		getAuthProvider: () => currentTestProviders().config.auth,
		getStorageProvider: () => currentTestProviders().config.storage,
		getDataProvider: () => currentTestProviders().config.data,
		getOrganizationProvider: () => currentTestProviders().config.data.orgs,
		getProjectProvider: () => currentTestProviders().config.data.projects,
		getDefinitionMeta: () => currentTestProviders().config.data.definitions,
		getComputeServerConfigStore: () => currentTestProviders().config.data.computeServer,
		getUserProfileStore: () => currentTestProviders().config.data.userProfile,
		getInviteStore: () => currentTestProviders().config.data.invites,
		getPermissionStore: () => currentTestProviders().config.data.permissions,
		getPlatformProjectGrantStore: () => currentTestProviders().config.data.platformProjectGrants,
		getAuditQuery: () => currentTestProviders().config.data.auditQuery ?? null,
		getEventSink: () => currentTestProviders().config.data.events ?? new NoopEventSink(),
		getErrorReporter: () => new NoopErrorReporter(),
		// Tests assert behavior, not log output; a no-op keeps the suite quiet.
		// One shared instance, not a fresh one per call, so a test can spy on the
		// logger and see the calls the code under test makes through it.
		getLogger: () => testLogger,
		// The real module's lazy indirection for long-lived providers. Tests have
		// one logger for the whole run, so it forwards to the same instance —
		// keeping a spy on `getLogger()` visible through this path too.
		lazyLogger: testLogger,
		getSolveMetricSink: () =>
			(currentTestProviders().config.data as { solveMetrics?: unknown }).solveMetrics ??
			new NoopSolveMetricSink()
	};
});
