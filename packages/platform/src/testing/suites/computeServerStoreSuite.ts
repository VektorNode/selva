/**
 * Adapter conformance suite for IComputeServerStore.
 *
 * Compute config is a single `ComputeConfig` per tenant scope — the
 * adapter's "store" surface is just `getConfig` / `saveConfig`. Tests
 * cover the round-trip and the default-server-id handling.
 */

import { describe, it, expect } from 'vitest';
import type { IComputeServerStore } from '../../data/interface.js';
import type { ComputeServerConfig } from '../../computeServer/types.js';
import { SYSTEM_CONTEXT, type RequestContext } from '../../context.js';
import { ALL_PLATFORM_PERMISSIONS } from '../../auth/types.js';
import { ALL_ORG_PERMISSIONS } from '../../organizations/schemas.js';
import { makeUuid } from './helpers.js';

export interface ComputeServerStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IComputeServerStore> | IComputeServerStore;
}

function server(overrides: Partial<ComputeServerConfig> = {}): ComputeServerConfig {
	return {
		id: overrides.id ?? makeUuid(),
		orgId: overrides.orgId,
		label: overrides.label ?? 'Test Server',
		serverUrl: overrides.serverUrl ?? 'http://localhost:5000',
		apiKey: overrides.apiKey,
		timeoutMs: overrides.timeoutMs,
		retryCount: overrides.retryCount
	};
}

function orgCtx(orgId: string): RequestContext {
	return {
		userId: '',
		actingOrgId: orgId,
		platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
		orgPermissions: [...ALL_ORG_PERMISSIONS],
		system: true
	};
}

export function runComputeServerStoreConformance(
	opts: ComputeServerStoreConformanceOptions
): void {
	const { name, createStore } = opts;

	describe(`IComputeServerStore conformance: ${name}`, () => {
		it('saveConfig + getConfig round-trips servers and defaultServerId', async () => {
			const store = await createStore();
			const s1 = server({ label: 'Primary' });
			const s2 = server({ label: 'Secondary', apiKey: 'secret' });
			await store.saveConfig(SYSTEM_CONTEXT, { servers: [s1, s2], defaultServerId: s1.id });

			const got = await store.getConfig(SYSTEM_CONTEXT);
			expect(got.servers.length).toBe(2);
			expect(got.servers.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
			expect(got.defaultServerId).toBe(s1.id);
		});

		it('saveConfig replaces the previous list', async () => {
			const store = await createStore();
			const oldS = server({ label: 'Old' });
			await store.saveConfig(SYSTEM_CONTEXT, { servers: [oldS] });

			const newS = server({ label: 'New' });
			await store.saveConfig(SYSTEM_CONTEXT, { servers: [newS] });

			const got = await store.getConfig(SYSTEM_CONTEXT);
			expect(got.servers.map((s) => s.id)).toEqual([newS.id]);
		});

		it('getConfig on empty returns an empty servers list', async () => {
			const store = await createStore();
			const got = await store.getConfig(SYSTEM_CONTEXT);
			expect(Array.isArray(got.servers)).toBe(true);
		});

		// ============================================================================
		// Org-scoped reads / writes (spec §3 BYO compute)
		// ============================================================================

		it('saveConfig in org scope is invisible to instance reads', async () => {
			const store = await createStore();
			const orgId = makeUuid();
			const orgServer = server({ label: "Org's BYO" });
			await store.saveConfig(orgCtx(orgId), { servers: [orgServer], defaultServerId: orgServer.id });

			const instance = await store.getConfig(SYSTEM_CONTEXT);
			expect(instance.servers.map((s) => s.id)).not.toContain(orgServer.id);
		});

		it('saveConfig in org scope returns its own servers + default on read', async () => {
			const store = await createStore();
			const orgId = makeUuid();
			const orgServer = server({ label: "Org's BYO" });
			await store.saveConfig(orgCtx(orgId), { servers: [orgServer], defaultServerId: orgServer.id });

			const got = await store.getConfig(orgCtx(orgId));
			expect(got.servers.map((s) => s.id)).toEqual([orgServer.id]);
			expect(got.defaultServerId).toBe(orgServer.id);
		});

		it('saving the instance scope does not clobber org-scoped servers (and vice versa)', async () => {
			const store = await createStore();
			const orgId = makeUuid();
			const instanceServer = server({ label: 'Instance Pool' });
			const orgServer = server({ label: "Org's BYO" });

			await store.saveConfig(SYSTEM_CONTEXT, {
				servers: [instanceServer],
				defaultServerId: instanceServer.id
			});
			await store.saveConfig(orgCtx(orgId), {
				servers: [orgServer],
				defaultServerId: orgServer.id
			});

			// Re-saving the instance scope should leave org rows untouched.
			const replacement = server({ label: 'Replacement' });
			await store.saveConfig(SYSTEM_CONTEXT, {
				servers: [replacement],
				defaultServerId: replacement.id
			});

			const instance = await store.getConfig(SYSTEM_CONTEXT);
			expect(instance.servers.map((s) => s.id)).toEqual([replacement.id]);
			const org = await store.getConfig(orgCtx(orgId));
			expect(org.servers.map((s) => s.id)).toEqual([orgServer.id]);
			expect(org.defaultServerId).toBe(orgServer.id);
		});
	});
}
