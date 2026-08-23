/**
 * Tests what the app-side binding adds on top of `@selvajs/solve/server`'s
 * cache (tested there): it keys on the server `id`, so a rotated URL/key is
 * the SAME entry until evicted; `evictComputeClient` / `evictChangedServers`
 * drop the warm client so the next request rebuilds against fresh connection
 * details.
 *
 * `GrasshopperClient.create` is mocked so no real Rhino.Compute handshake runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComputeServerConfig } from '@selvajs/platform';

// Each create() returns a distinct client so entries are distinguishable.
const createSpy = vi.fn(async (cfg: { serverUrl: string; apiKey?: string }) => {
	const scheduler = { dispose: vi.fn() };
	return {
		__id: `${cfg.serverUrl}|${cfg.apiKey ?? ''}`,
		createScheduler: () => scheduler
	};
});

vi.mock('@selvajs/compute/grasshopper', () => ({
	GrasshopperClient: { create: createSpy }
}));
vi.mock('@selvajs/compute/core', () => ({
	enableDebugLogging: () => {}
}));

// Import after the mock is registered.
const { getClient, evictComputeClient } = await import('../engine.server.js');
const { evictChangedServers } = await import('../evictChangedServers.js');

function server(id: string, url: string, apiKey?: string): ComputeServerConfig {
	return {
		id,
		label: id,
		serverUrl: url,
		apiKey,
		scope: 'platform',
		sharedWith: 'all'
	};
}

beforeEach(() => {
	createSpy.mockClear();
});

describe('app compute client-cache binding', () => {
	it('reuses one client for repeated requests to the same server id', async () => {
		const s = server('reuse-1', 'https://a.example.com', 'key-a');
		const first = await getClient(s);
		const second = await getClient(s);

		expect(second.client).toBe(first.client);
		expect(createSpy).toHaveBeenCalledTimes(1);
	});

	it('keeps separate clients for different server ids (per-definition pinning)', async () => {
		const a = await getClient(server('sep-a', 'https://a.example.com', 'key-a'));
		const b = await getClient(server('sep-b', 'https://b.example.com', 'key-b'));

		expect(a.client).not.toBe(b.client);
		expect((await getClient(server('sep-a', 'https://a.example.com', 'key-a'))).client).toBe(
			a.client
		);
	});

	it('keys on id: a rotated URL/key under the same id is the SAME entry until evicted', async () => {
		const before = await getClient(server('rot-1', 'https://old.example.com', 'old-key'));
		const after = await getClient(server('rot-1', 'https://new.example.com', 'new-key'));

		// Identity is the id, so no fresh client is built on rotation.
		expect(after.client).toBe(before.client);
		expect(createSpy).toHaveBeenCalledTimes(1);
	});

	it('evictComputeClient forces a rebuild for that id', async () => {
		const before = await getClient(server('evict-1', 'https://a.example.com', 'key'));
		evictComputeClient('evict-1');
		const after = await getClient(server('evict-1', 'https://a.example.com', 'new-key'));

		expect(after.client).not.toBe(before.client);
		expect(createSpy).toHaveBeenCalledTimes(2);
	});
});

describe('evictChangedServers', () => {
	const conn = (id: string, serverUrl: string, apiKey?: string) => ({ id, serverUrl, apiKey });

	it('evicts a server whose serverUrl changed', async () => {
		const before = await getClient(server('c-url', 'https://old.example.com', 'k'));
		evictChangedServers(
			[conn('c-url', 'https://old.example.com', 'k')],
			[conn('c-url', 'https://new.example.com', 'k')]
		);
		const after = await getClient(server('c-url', 'https://new.example.com', 'k'));
		expect(after.client).not.toBe(before.client);
	});

	it('evicts a server whose apiKey changed', async () => {
		const before = await getClient(server('c-key', 'https://a.example.com', 'old'));
		evictChangedServers(
			[conn('c-key', 'https://a.example.com', 'old')],
			[conn('c-key', 'https://a.example.com', 'new')]
		);
		const after = await getClient(server('c-key', 'https://a.example.com', 'new'));
		expect(after.client).not.toBe(before.client);
	});

	it('evicts a removed server', async () => {
		const before = await getClient(server('c-gone', 'https://a.example.com', 'k'));
		evictChangedServers([conn('c-gone', 'https://a.example.com', 'k')], []);
		const after = await getClient(server('c-gone', 'https://a.example.com', 'k'));
		expect(after.client).not.toBe(before.client);
	});

	it('leaves an unchanged server warm (no rebuild)', async () => {
		const before = await getClient(server('c-same', 'https://a.example.com', 'k'));
		createSpy.mockClear();
		evictChangedServers(
			[conn('c-same', 'https://a.example.com', 'k')],
			[conn('c-same', 'https://a.example.com', 'k')]
		);
		const after = await getClient(server('c-same', 'https://a.example.com', 'k'));
		expect(after.client).toBe(before.client);
		expect(createSpy).not.toHaveBeenCalled();
	});
});
