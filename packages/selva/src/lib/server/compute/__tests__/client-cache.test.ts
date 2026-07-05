/**
 * Tests for the shared per-server compute client cache (§2a). The property that
 * matters for multi-instance-per-definition setups: the cache is keyed by
 * (serverUrl, apiKey), so a definition pinned to a different compute server
 * transparently gets that server's own client — two servers never share one
 * client, and the same server always reuses its warm client across the solve
 * and render paths.
 *
 * `GrasshopperClient.create` is mocked so no real Rhino.Compute handshake runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComputeServerConfig } from '@selvajs/platform';

// Each create() returns a distinct client so we can tell entries apart. The
// scheduler is a stub with the dispose() the LRU eviction calls.
const createSpy = vi.fn(async (cfg: { serverUrl: string; apiKey?: string }) => {
	const scheduler = { dispose: vi.fn() };
	return {
		__id: `${cfg.serverUrl}|${cfg.apiKey ?? ''}`,
		createScheduler: () => scheduler
	};
});

vi.mock('@selvajs/compute', () => ({
	GrasshopperClient: { create: createSpy },
	enableDebugLogging: () => {}
}));

// Import AFTER the mock is registered.
const { getClient } = await import('../clientCache.server.js');

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

describe('shared compute client cache', () => {
	it('reuses one client for repeated requests to the same server', async () => {
		const s = server('s1', 'https://a.example.com', 'key-a');
		const first = await getClient(s);
		const second = await getClient(s);

		expect(second.client).toBe(first.client);
		expect(createSpy).toHaveBeenCalledTimes(1); // built once, then cached
	});

	it('keeps separate clients for different servers (per-definition pinning)', async () => {
		const a = await getClient(server('s1', 'https://a.example.com', 'key-a'));
		const b = await getClient(server('s2', 'https://b.example.com', 'key-b'));

		expect(a.client).not.toBe(b.client);
		// Each still hits its own warm entry on the next call.
		expect((await getClient(server('s1', 'https://a.example.com', 'key-a'))).client).toBe(a.client);
		expect((await getClient(server('s2', 'https://b.example.com', 'key-b'))).client).toBe(b.client);
	});

	it('treats a changed apiKey as a different server (fresh client)', async () => {
		// Same URL, rotated key → new cache key → new client. The old entry is
		// left to age out via LRU (no in-place mutation of a live client).
		const before = await getClient(server('s1', 'https://a.example.com', 'old-key'));
		const after = await getClient(server('s1', 'https://a.example.com', 'new-key'));

		expect(after.client).not.toBe(before.client);
	});

	it('treats a changed serverUrl as a different server (fresh client)', async () => {
		const before = await getClient(server('s1', 'https://old.example.com', 'key'));
		const after = await getClient(server('s1', 'https://new.example.com', 'key'));

		expect(after.client).not.toBe(before.client);
	});
});
