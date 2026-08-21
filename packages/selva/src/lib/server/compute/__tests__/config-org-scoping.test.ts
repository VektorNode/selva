/**
 * `getConfig` returns the whole instance's server list by default — every
 * platform server and every other org's org-private servers. Both org-facing
 * callers filtered it themselves, which is the shape to avoid: a rule two
 * endpoints must agree on, copied into both. `globalDefaultServerId`
 * passed through unfiltered even so.
 *
 * `scopeToOrgId` moves the filter into the store. What leaks without it is
 * internal network topology (Rhino.Compute hostnames) — `apiKey` is separately
 * withheld unless `includeApiKeys` is set.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import type { ComputeServerConfig } from '@selvajs/platform';
import { freshProviders, type TestProviders } from '$lib/server/__tests__/fixtures.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

const ACME = 'org-acme';
const OTHER = 'org-other';

function platformServer(id: string, sharedWith: 'all' | string[]): ComputeServerConfig {
	return { id, label: id, serverUrl: `https://${id}.internal`, scope: 'platform', sharedWith };
}

function orgServer(id: string, ownerOrgId: string): ComputeServerConfig {
	return { id, label: id, serverUrl: `https://${id}.internal`, scope: 'org', ownerOrgId };
}

async function seedServers(tp: TestProviders) {
	const store = tp.config.data.computeServer;
	await store.savePlatformServers(
		SYSTEM_CONTEXT,
		[
			platformServer('shared-all', 'all'),
			platformServer('acme-only', [ACME]),
			platformServer('other-only', [OTHER]),
			platformServer('global-default', [OTHER])
		],
		'global-default'
	);
	await store.saveOrgServers(
		SYSTEM_CONTEXT,
		ACME,
		[orgServer('acme-private', ACME)],
		'acme-private'
	);
	await store.saveOrgServers(SYSTEM_CONTEXT, OTHER, [orgServer('other-private', OTHER)]);
	return store;
}

describe('getConfig({ scopeToOrgId })', () => {
	it("omits other orgs' private servers and unshared platform servers", async () => {
		tp = await freshProviders();
		const store = await seedServers(tp);

		const scoped = await store.getConfig(SYSTEM_CONTEXT, { scopeToOrgId: ACME });
		const ids = scoped.servers.map((s) => s.id).sort();

		// `global-default` is shared only with OTHER but is the global default,
		// which `serversVisibleTo` treats as usable everywhere.
		expect(ids).toEqual(['acme-only', 'acme-private', 'global-default', 'shared-all']);
		expect(ids).not.toContain('other-private');
		expect(ids).not.toContain('other-only');
	});

	it("reduces orgDefaults to the scoped org's own entry", async () => {
		tp = await freshProviders();
		const store = await seedServers(tp);

		const scoped = await store.getConfig(SYSTEM_CONTEXT, { scopeToOrgId: ACME });

		expect(scoped.orgDefaults).toEqual({ [ACME]: 'acme-private' });
		expect(scoped.orgDefaults?.[OTHER]).toBeUndefined();
	});

	it('blanks defaultServerId when the global default is not visible', async () => {
		tp = await freshProviders();
		const store = tp.config.data.computeServer;
		// The default is dormant: shared with nobody and not the global default's
		// usual free pass, because here the default is a *different* server.
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[platformServer('hidden', []), platformServer('visible', [ACME])],
			undefined
		);
		await store.saveOrgServers(SYSTEM_CONTEXT, ACME, []);

		const scoped = await store.getConfig(SYSTEM_CONTEXT, { scopeToOrgId: ACME });

		expect(scoped.defaultServerId).toBeUndefined();
		expect(scoped.servers.map((s) => s.id)).toEqual(['visible']);
	});

	it('returns the whole instance when no scope is passed', async () => {
		// Admin surfaces, boot health and the save-diff handlers depend on this.
		tp = await freshProviders();
		const store = await seedServers(tp);

		const all = await store.getConfig(SYSTEM_CONTEXT);
		const ids = all.servers.map((s) => s.id);

		expect(ids).toContain('other-private');
		expect(ids).toContain('other-only');
		expect(all.defaultServerId).toBe('global-default');
	});
});
