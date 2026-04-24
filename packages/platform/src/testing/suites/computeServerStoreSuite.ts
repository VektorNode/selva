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
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeUuid } from './helpers.js';

export interface ComputeServerStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IComputeServerStore> | IComputeServerStore;
}

function server(overrides: Partial<ComputeServerConfig> = {}): ComputeServerConfig {
	return {
		id: overrides.id ?? makeUuid(),
		label: overrides.label ?? 'Test Server',
		serverUrl: overrides.serverUrl ?? 'http://localhost:5000',
		apiKey: overrides.apiKey,
		timeoutMs: overrides.timeoutMs,
		retryCount: overrides.retryCount
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
	});
}
