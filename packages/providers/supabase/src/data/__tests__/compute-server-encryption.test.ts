/**
 * CI-runnable (no live stack) unit tests for at-rest encryption of
 * `compute_servers.api_key`. A minimal fake of the Supabase query builder
 * records `insert` payloads and serves canned `select` rows, so the tests
 * assert the exact bytes that would reach the DB without a real Postgres.
 *
 * Security property under test: a plaintext apiKey handed to the store is
 * NEVER written verbatim — the DB only ever sees an `enc:v1:` envelope — and
 * it round-trips back to plaintext on read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { isEncryptedSecret, decryptSecret } from '@selvajs/platform/computeServer';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseComputeServerStore } from '../SupabaseComputeServerStore.js';
import type { ClientBundle } from '../client.js';

const SYSTEM_CTX = { userId: '', system: true } as unknown as RequestContext;
const KEY = randomBytes(32);

/**
 * Records every `insert` payload and returns canned rows for each table's
 * `select`. Only the fragments the store actually chains are implemented.
 */
function fakeBundle(selectRows: Record<string, unknown[]> = {}) {
	const inserted: Record<string, unknown[]> = {};
	const selected: Record<string, string> = {};

	function builder(table: string) {
		const rows = selectRows[table] ?? [];
		const result = { data: rows, error: null };
		const chain: Record<string, unknown> = {
			select: (columns?: string) => {
				if (typeof columns === 'string') selected[table] = columns;
				return {
					...chain,
					// Filters canned rows so single-row reads (getServerApiKey)
					// resolve the row they asked for.
					eq: (column: string, value: unknown) => {
						const matched = rows.filter((r) => (r as Record<string, unknown>)[column] === value);
						return {
							...chain,
							maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
							then: (resolve: (v: unknown) => unknown) => resolve({ data: matched, error: null })
						};
					},
					then: (resolve: (v: unknown) => unknown) => resolve(result)
				};
			},
			insert: (rows: unknown) => {
				inserted[table] = (inserted[table] ?? []).concat(rows as unknown[]);
				return { error: null };
			},
			delete: () => ({ eq: () => ({ eq: () => ({ error: null }), error: null }) }),
			update: () => ({ eq: () => ({ error: null }) }),
			upsert: () => ({ error: null })
		};
		return chain;
	}

	const client = { from: (t: string) => builder(t) };
	const bundle = {
		serviceClient: client,
		forRequest: () => client
	} as unknown as ClientBundle;
	return { bundle, inserted, selected };
}

describe('SupabaseComputeServerStore — apiKey encryption at rest', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('encrypts apiKey before insert — DB never sees plaintext', async () => {
		const { bundle, inserted } = fakeBundle();
		const store = new SupabaseComputeServerStore(bundle, KEY);

		await store.savePlatformServers(
			SYSTEM_CTX,
			[
				{
					id: 's1',
					label: 'prod',
					serverUrl: 'https://compute.example.com',
					apiKey: 'super-secret-key',
					scope: 'platform',
					sharedWith: 'all'
				}
			],
			's1'
		);

		const rows = inserted['compute_servers'] as Array<{ api_key: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0].api_key).not.toBe('super-secret-key');
		expect(isEncryptedSecret(rows[0].api_key)).toBe(true);
		expect(decryptSecret(rows[0].api_key, KEY)).toBe('super-secret-key');
	});

	it('decrypts apiKey on read — callers see plaintext', async () => {
		const { encryptSecret } = await import('@selvajs/platform/computeServer');
		const envelope = encryptSecret('round-trip-key', KEY);
		const { bundle } = fakeBundle({
			compute_servers: [
				{
					id: 's1',
					scope: 'platform',
					owner_org_id: null,
					shared_with_all: true,
					label: 'prod',
					server_url: 'https://compute.example.com',
					api_key: envelope,
					timeout_ms: null,
					retry_count: null
				}
			]
		});
		const store = new SupabaseComputeServerStore(bundle, KEY);

		const config = await store.getConfig(SYSTEM_CTX, { includeApiKeys: true });
		expect(config.servers).toHaveLength(1);
		expect(config.servers[0].apiKey).toBe('round-trip-key');
	});

	it('getConfig omits apiKey by default, and never selects the column', async () => {
		const { encryptSecret } = await import('@selvajs/platform/computeServer');
		const envelope = encryptSecret('round-trip-key', KEY);
		const { bundle, selected } = fakeBundle({
			compute_servers: [
				{
					id: 's1',
					scope: 'platform',
					owner_org_id: null,
					shared_with_all: true,
					label: 'prod',
					server_url: 'https://compute.example.com',
					api_key: envelope,
					has_api_key: true,
					timeout_ms: null,
					retry_count: null
				}
			]
		});
		const store = new SupabaseComputeServerStore(bundle, KEY);

		const config = await store.getConfig(SYSTEM_CTX);
		expect(config.servers[0].apiKey).toBeUndefined();
		// Presence is still reported — from the generated column, not the secret.
		expect(config.servers[0].hasApiKey).toBe(true);
		// Split on commas so `has_api_key` doesn't satisfy a substring match on `api_key`.
		const columns = selected['compute_servers'].split(',').map((c) => c.trim());
		expect(columns).not.toContain('api_key');
		expect(columns).toContain('has_api_key');
	});

	it('getServerApiKey decrypts one key and tolerates an unknown id', async () => {
		const { encryptSecret } = await import('@selvajs/platform/computeServer');
		const { bundle } = fakeBundle({
			compute_servers: [
				{
					id: 's1',
					scope: 'platform',
					owner_org_id: null,
					shared_with_all: true,
					label: 'prod',
					server_url: 'https://compute.example.com',
					api_key: encryptSecret('round-trip-key', KEY),
					has_api_key: true,
					timeout_ms: null,
					retry_count: null
				}
			]
		});
		const store = new SupabaseComputeServerStore(bundle, KEY);

		expect(await store.getServerApiKey(SYSTEM_CTX, 's1')).toBe('round-trip-key');
		expect(await store.getServerApiKey(SYSTEM_CTX, 'nope')).toBeUndefined();
	});

	it('throws rather than persist plaintext when no key is configured', async () => {
		const { bundle } = fakeBundle();
		const store = new SupabaseComputeServerStore(bundle);

		await expect(
			store.savePlatformServers(
				SYSTEM_CTX,
				[
					{
						id: 's1',
						label: 'prod',
						serverUrl: 'https://compute.example.com',
						apiKey: 'secret',
						scope: 'platform',
						sharedWith: 'all'
					}
				],
				's1'
			)
		).rejects.toThrow(/SELVA_AT_REST_KEY/);
	});

	it('verifySecrets flags a plaintext row', async () => {
		const { bundle } = fakeBundle({
			compute_servers: [{ id: 's1', label: 'legacy', api_key: 'raw-plaintext' }]
		});
		const store = new SupabaseComputeServerStore(bundle, KEY);

		const report = await store.verifySecrets();
		expect(report.ok).toBe(false);
		expect(report.plaintextFound).toBe(true);
		expect(report.failures).toEqual([
			{ serverId: 's1', serverLabel: 'legacy', reason: 'plaintext_on_disk' }
		]);
	});

	it('verifySecrets reports key_mismatch when the at-rest key rotated', async () => {
		const { encryptSecret } = await import('@selvajs/platform/computeServer');
		const envelope = encryptSecret('secret', randomBytes(32));
		const { bundle } = fakeBundle({
			compute_servers: [{ id: 's1', label: 'prod', api_key: envelope }]
		});
		const store = new SupabaseComputeServerStore(bundle, KEY);

		const report = await store.verifySecrets();
		expect(report.ok).toBe(false);
		expect(report.plaintextFound).toBe(false);
		expect(report.failures[0]).toMatchObject({ serverId: 's1', reason: 'key_mismatch' });
	});

	it('verifySecrets returns ok when every apiKey decrypts', async () => {
		const { encryptSecret } = await import('@selvajs/platform/computeServer');
		const { bundle } = fakeBundle({
			compute_servers: [{ id: 's1', label: 'prod', api_key: encryptSecret('k', KEY) }]
		});
		const store = new SupabaseComputeServerStore(bundle, KEY);

		const report = await store.verifySecrets();
		expect(report).toEqual({ ok: true, failures: [], plaintextFound: false });
	});
});
