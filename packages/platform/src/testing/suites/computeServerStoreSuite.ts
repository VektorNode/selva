/**
 * Adapter conformance suite for IComputeServerStore.
 *
 * Architecture spec §4.8 — servers are scoped (platform vs. org-private), with a global
 * `defaultServerId` and per-org `orgDefaults`. The store surface exposes
 * scope-targeted mutations; visibility filtering is done by callers via
 * the pure helpers in `@selvajs/platform`.
 */

import { describe, it, expect } from 'vitest';
import type { IComputeServerStore } from '../../computeServer/interface.js';
import type {
	ComputeServerConfig,
	OrgComputeServer,
	PlatformComputeServer
} from '../../computeServer/types.js';
import { isOrgServer, isPlatformServer } from '../../computeServer/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeUuid } from './helpers.js';

export interface ComputeServerStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IComputeServerStore> | IComputeServerStore;
	/**
	 * Optional hook adapters with FK constraints use to seed an `orgs` row
	 * before the suite writes an org-scoped compute config that FK-references
	 * it. Adapters without org FKs (local JSON) can omit this.
	 */
	seedOrg?: (orgId: string) => Promise<void>;
}

function platformServer(
	overrides: Partial<Omit<PlatformComputeServer, 'scope'>> = {}
): PlatformComputeServer {
	return {
		id: overrides.id ?? makeUuid(),
		scope: 'platform',
		sharedWith: overrides.sharedWith ?? 'all',
		label: overrides.label ?? 'Test Server',
		serverUrl: overrides.serverUrl ?? 'http://localhost:5000',
		apiKey: overrides.apiKey,
		timeoutMs: overrides.timeoutMs,
		retryCount: overrides.retryCount
	};
}

function orgServer(
	ownerOrgId: string,
	overrides: Partial<Omit<OrgComputeServer, 'scope' | 'ownerOrgId'>> = {}
): OrgComputeServer {
	return {
		id: overrides.id ?? makeUuid(),
		scope: 'org',
		ownerOrgId,
		label: overrides.label ?? 'Org Server',
		serverUrl: overrides.serverUrl ?? 'http://localhost:5001',
		apiKey: overrides.apiKey,
		timeoutMs: overrides.timeoutMs,
		retryCount: overrides.retryCount
	};
}

export function runComputeServerStoreConformance(opts: ComputeServerStoreConformanceOptions): void {
	const { name, createStore, seedOrg } = opts;
	const seed = async (): Promise<string> => {
		const id = makeUuid();
		if (seedOrg) await seedOrg(id);
		return id;
	};

	describe(`IComputeServerStore conformance: ${name}`, () => {
		it('savePlatformServers + getConfig round-trips servers and defaultServerId', async () => {
			const store = await createStore();
			const s1 = platformServer({ label: 'Primary' });
			const s2 = platformServer({ label: 'Secondary', apiKey: 'secret' });
			await store.savePlatformServers(SYSTEM_CONTEXT, [s1, s2], s1.id);

			const got = await store.getConfig(SYSTEM_CONTEXT);
			const platformIds = got.servers.filter(isPlatformServer).map((s) => s.id);
			expect(platformIds.sort()).toEqual([s1.id, s2.id].sort());
			expect(got.defaultServerId).toBe(s1.id);
		});

		it('savePlatformServers replaces the previous platform set', async () => {
			const store = await createStore();
			await store.savePlatformServers(
				SYSTEM_CONTEXT,
				[platformServer({ label: 'Old' })],
				undefined
			);

			const newS = platformServer({ label: 'New' });
			await store.savePlatformServers(SYSTEM_CONTEXT, [newS], newS.id);

			const got = await store.getConfig(SYSTEM_CONTEXT);
			const platformIds = got.servers.filter(isPlatformServer).map((s) => s.id);
			expect(platformIds).toEqual([newS.id]);
		});

		it('getConfig on empty returns an empty servers list', async () => {
			const store = await createStore();
			const got = await store.getConfig(SYSTEM_CONTEXT);
			expect(Array.isArray(got.servers)).toBe(true);
		});

		// ============================================================================
		// Org-private servers + orgDefaults (Architecture spec §4.8)
		// ============================================================================

		it('saveOrgServers stores rows owned by the org', async () => {
			const store = await createStore();
			const orgId = await seed();
			const s = orgServer(orgId, { label: "Org's BYO" });
			await store.saveOrgServers(SYSTEM_CONTEXT, orgId, [s], s.id);

			const got = await store.getConfig(SYSTEM_CONTEXT);
			const ownRows = got.servers.filter(
				(row): row is OrgComputeServer => isOrgServer(row) && row.ownerOrgId === orgId
			);
			expect(ownRows.map((r) => r.id)).toEqual([s.id]);
			expect(got.orgDefaults?.[orgId]).toBe(s.id);
		});

		it('saveOrgServers does not clobber platform rows (and vice versa)', async () => {
			const store = await createStore();
			const orgId = await seed();
			const platS = platformServer({ label: 'Platform' });
			const orgS = orgServer(orgId, { label: 'Org' });

			await store.savePlatformServers(SYSTEM_CONTEXT, [platS], platS.id);
			await store.saveOrgServers(SYSTEM_CONTEXT, orgId, [orgS], orgS.id);

			// Replacing the platform set should leave org rows untouched.
			const replacement = platformServer({ label: 'Replacement' });
			await store.savePlatformServers(SYSTEM_CONTEXT, [replacement], replacement.id);

			const got = await store.getConfig(SYSTEM_CONTEXT);
			const platformIds = got.servers.filter(isPlatformServer).map((s) => s.id);
			expect(platformIds).toEqual([replacement.id]);
			const orgIds = got.servers
				.filter((s): s is OrgComputeServer => isOrgServer(s) && s.ownerOrgId === orgId)
				.map((s) => s.id);
			expect(orgIds).toEqual([orgS.id]);
			expect(got.defaultServerId).toBe(replacement.id);
			expect(got.orgDefaults?.[orgId]).toBe(orgS.id);
		});

		it('setOrgDefault updates and clears the per-org default', async () => {
			const store = await createStore();
			const orgId = await seed();
			const s = orgServer(orgId);
			await store.saveOrgServers(SYSTEM_CONTEXT, orgId, [s]);

			await store.setOrgDefault(SYSTEM_CONTEXT, orgId, s.id);
			let got = await store.getConfig(SYSTEM_CONTEXT);
			expect(got.orgDefaults?.[orgId]).toBe(s.id);

			await store.setOrgDefault(SYSTEM_CONTEXT, orgId, null);
			got = await store.getConfig(SYSTEM_CONTEXT);
			expect(got.orgDefaults?.[orgId]).toBeUndefined();
		});

		it('deleteByOrg removes org-private rows and the orgDefaults entry', async () => {
			const store = await createStore();
			const orgId = await seed();
			const orgS = orgServer(orgId);
			await store.saveOrgServers(SYSTEM_CONTEXT, orgId, [orgS], orgS.id);

			await store.deleteByOrg(SYSTEM_CONTEXT, orgId);

			const got = await store.getConfig(SYSTEM_CONTEXT);
			const remaining = got.servers.filter(
				(s): s is ComputeServerConfig => isOrgServer(s) && s.ownerOrgId === orgId
			);
			expect(remaining).toEqual([]);
			expect(got.orgDefaults?.[orgId]).toBeUndefined();
		});

		it('deleteByOrg strips this org from platform sharedWith allowlists', async () => {
			const store = await createStore();
			const orgId = await seed();
			const otherOrgId = await seed();
			const platS = platformServer({ sharedWith: [orgId, otherOrgId] });
			await store.savePlatformServers(SYSTEM_CONTEXT, [platS], platS.id);

			await store.deleteByOrg(SYSTEM_CONTEXT, orgId);

			const got = await store.getConfig(SYSTEM_CONTEXT);
			const found = got.servers.find(
				(s): s is PlatformComputeServer => isPlatformServer(s) && s.id === platS.id
			);
			expect(found?.sharedWith).toEqual([otherOrgId]);
		});
	});
}
