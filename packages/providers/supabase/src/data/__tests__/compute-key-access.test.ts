/**
 * `compute_servers.api_key` is not readable from a session. A non-member could
 * otherwise read a shared platform server's ciphertext over REST, and a key is
 * only decrypted for a server the caller's own RLS read can see.
 */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { encryptSecret } from '@selvajs/platform/computeServer';
import { SupabaseComputeServerStore } from '../SupabaseComputeServerStore.js';
import type { ClientBundle } from '../client.js';
import { actAs, migratedDb, seedUser } from './pglite-harness.js';

describe('compute_servers.api_key grants', () => {
	let db: PGlite;
	let user: string;
	const server = crypto.randomUUID();

	beforeAll(async () => {
		db = await migratedDb();
		user = await seedUser(db);
		await db.query(
			`insert into selva.compute_servers (id, scope, shared_with_all, label, server_url, api_key)
			 values ($1, 'platform', true, 'Shared', 'http://c', 'enc:v2:abc')`,
			[server]
		);
	});

	it('refuses reading the key', async () => {
		await expect(
			actAs(db, { sub: user }, `select api_key from selva.compute_servers where id = $1`, [server])
		).rejects.toThrow(/permission denied/);
	});

	it('still lets a session list servers and see that a key is set', async () => {
		const rows = await actAs(
			db,
			{ sub: user },
			`select id, label, has_api_key from selva.compute_servers where id = $1`,
			[server]
		);
		expect(rows).toEqual([{ id: server, label: 'Shared', has_api_key: true }]);
	});
});

describe('SupabaseComputeServerStore key reads', () => {
	const KEY = Buffer.alloc(32, 7);
	const ctx = { userId: 'u' } as unknown as RequestContext;
	const row = (id: string) => ({
		id,
		scope: 'platform',
		owner_org_id: null,
		shared_with_all: true,
		label: id,
		server_url: 'http://c',
		timeout_ms: null,
		retry_count: null,
		has_api_key: true
	});

	function bundle(visible: string[]) {
		const keys = new Map(['a', 'b'].map((id) => [id, encryptSecret(`key-${id}`, KEY, id)]));
		const serviceFrom = vi.fn(() => ({
			select: () => ({
				eq: (_col: string, id: string) => ({
					maybeSingle: async () => ({ data: { id, label: id, api_key: keys.get(id) }, error: null })
				}),
				in: async (_col: string, ids: string[]) => ({
					data: ids.map((id) => ({ id, label: id, api_key: keys.get(id) })),
					error: null
				})
			})
		}));
		const select = (columns?: string) => {
			expect(columns ?? '').not.toContain('api_key,');
			const rows = visible.map(row);
			return {
				eq: (col: string, value: unknown) => ({
					maybeSingle: async () => ({
						data: col === 'singleton' ? null : (rows.find((r) => r.id === value) ?? null),
						error: null
					})
				}),
				then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
			};
		};
		const session = {
			from: (table: string) =>
				table === 'compute_servers'
					? { select }
					: {
							select: () => ({
								eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
								then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
							})
						}
		};
		return {
			bundle: {
				forRequest: () => session,
				serviceClient: { from: serviceFrom }
			} as unknown as ClientBundle,
			serviceFrom
		};
	}

	it('returns the key of a server the session can see', async () => {
		const { bundle: b } = bundle(['a']);
		const store = new SupabaseComputeServerStore(b, KEY);
		expect(await store.getServerApiKey(ctx, 'a')).toBe('key-a');
	});

	it('returns nothing for a server RLS hides, without touching the key', async () => {
		const { bundle: b, serviceFrom } = bundle([]);
		const store = new SupabaseComputeServerStore(b, KEY);
		expect(await store.getServerApiKey(ctx, 'a')).toBeUndefined();
		expect(serviceFrom).not.toHaveBeenCalled();
	});

	it('getConfig with keys decrypts only what the session can see', async () => {
		const { bundle: b } = bundle(['b']);
		const store = new SupabaseComputeServerStore(b, KEY);
		const config = await store.getConfig(ctx, { includeApiKeys: true });
		expect(config.servers.map((s) => [s.id, s.apiKey])).toEqual([['b', 'key-b']]);
	});
});
