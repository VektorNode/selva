/** A compute save either lands whole or leaves the stored set alone. */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputeServerConfig, RequestContext } from '@selvajs/platform';
import { SupabaseComputeServerStore } from '../SupabaseComputeServerStore.js';
import type { ClientBundle } from '../client.js';
import { actAs, migratedDb, seedOrg, seedOrgMember, seedUser } from './pglite-harness.js';

let db: PGlite;
let admin: string;
let acme: string;
let other: string;

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	label: 'S',
	server_url: 'http://c',
	api_key: 'enc:v2:k',
	timeout_ms: null,
	retry_count: null,
	shared_with_all: true,
	...overrides
});

const saveOrg = `select selva.save_org_compute_servers($1, $2::jsonb, $3, $4)`;
const savePlatform = `select selva.save_platform_compute_servers($1::jsonb, $2::jsonb, $3)`;

async function serverIds(scope: string): Promise<string[]> {
	const { rows } = await db.query<{ id: string }>(
		`select id from selva.compute_servers where scope = $1`,
		[scope]
	);
	return rows.map((r) => r.id).sort();
}

beforeAll(async () => {
	db = await migratedDb();
	const owner = await seedUser(db);
	const manager = await seedUser(db);
	admin = await seedUser(db);
	await db.query(
		`update selva.user_profiles set platform_permissions = '{instance_admin}' where user_id = $1`,
		[admin]
	);
	acme = await seedOrg(db, owner);
	other = await seedOrg(db, owner);
	await seedOrgMember(db, acme, manager, 'admin', ['manage_org_compute']);
	manage = manager;
});

let manage: string;

beforeEach(async () => {
	await db.exec(`delete from selva.compute_servers`);
});

describe('save_platform_compute_servers', () => {
	it('keeps org defaults on a server that stays', async () => {
		const id = crypto.randomUUID();
		const json = JSON.stringify([row(id)]);
		await actAs(db, { sub: admin }, savePlatform, [json, '[]', id]);
		await db.query(`insert into selva.compute_server_org_defaults values ($1, $2)`, [acme, id]);

		await actAs(db, { sub: admin }, savePlatform, [json, '[]', id]);

		const { rows } = await db.query(
			`select 1 from selva.compute_server_org_defaults where default_server_id = $1`,
			[id]
		);
		expect(rows).toHaveLength(1);
	});

	it('leaves the stored set alone when a row fails', async () => {
		const id = crypto.randomUUID();
		await actAs(db, { sub: admin }, savePlatform, [JSON.stringify([row(id)]), '[]', id]);

		const bad = JSON.stringify([row(crypto.randomUUID(), { timeout_ms: 3e9 })]);
		await expect(actAs(db, { sub: admin }, savePlatform, [bad, '[]', null])).rejects.toThrow();

		expect(await serverIds('platform')).toEqual([id]);
	});

	it('drops servers left out of the set', async () => {
		const kept = crypto.randomUUID();
		const dropped = crypto.randomUUID();
		const both = JSON.stringify([row(kept), row(dropped)]);
		await actAs(db, { sub: admin }, savePlatform, [both, '[]', kept]);

		await actAs(db, { sub: admin }, savePlatform, [JSON.stringify([row(kept)]), '[]', kept]);

		expect(await serverIds('platform')).toEqual([kept]);
	});

	it('replaces the share list', async () => {
		const id = crypto.randomUUID();
		const json = JSON.stringify([row(id, { shared_with_all: false })]);
		const shares = (org: string) => JSON.stringify([{ server_id: id, org_id: org }]);
		await actAs(db, { sub: admin }, savePlatform, [json, shares(acme), null]);

		await actAs(db, { sub: admin }, savePlatform, [json, shares(other), null]);

		const { rows } = await db.query<{ org_id: string }>(
			`select org_id from selva.compute_server_shares where server_id = $1`,
			[id]
		);
		expect(rows).toEqual([{ org_id: other }]);
	});

	it('refuses a session without instance rights and changes nothing', async () => {
		const id = crypto.randomUUID();
		await actAs(db, { sub: admin }, savePlatform, [JSON.stringify([row(id)]), '[]', id]);

		await expect(
			actAs(db, { sub: manage }, savePlatform, [
				JSON.stringify([row(crypto.randomUUID())]),
				'[]',
				null
			])
		).rejects.toThrow();

		expect(await serverIds('platform')).toEqual([id]);
	});
});

describe('save_org_compute_servers', () => {
	it('replaces the org set and sets its default', async () => {
		const id = crypto.randomUUID();
		await actAs(db, { sub: manage }, saveOrg, [acme, JSON.stringify([row(id)]), true, id]);

		expect(await serverIds('org')).toEqual([id]);
		const { rows } = await db.query<{ default_server_id: string }>(
			`select default_server_id from selva.compute_server_org_defaults where org_id = $1`,
			[acme]
		);
		expect(rows).toEqual([{ default_server_id: id }]);
	});

	it('leaves the default alone unless asked', async () => {
		const id = crypto.randomUUID();
		const json = JSON.stringify([row(id)]);
		await actAs(db, { sub: manage }, saveOrg, [acme, json, true, id]);

		await actAs(db, { sub: manage }, saveOrg, [acme, json, false, null]);

		const { rows } = await db.query(
			`select 1 from selva.compute_server_org_defaults where org_id = $1`,
			[acme]
		);
		expect(rows).toHaveLength(1);
	});

	it('refuses an id that collides with a platform server, and keeps the old set', async () => {
		const platform = crypto.randomUUID();
		const mine = crypto.randomUUID();
		await actAs(db, { sub: admin }, savePlatform, [
			JSON.stringify([row(platform)]),
			'[]',
			platform
		]);
		await actAs(db, { sub: manage }, saveOrg, [acme, JSON.stringify([row(mine)]), false, null]);

		await expect(
			actAs(db, { sub: manage }, saveOrg, [acme, JSON.stringify([row(platform)]), false, null])
		).rejects.toThrow(/already in use/);

		expect(await serverIds('org')).toEqual([mine]);
		expect(await serverIds('platform')).toEqual([platform]);
	});

	it('refuses a member of another org', async () => {
		await expect(
			actAs(db, { sub: manage }, saveOrg, [
				other,
				JSON.stringify([row(crypto.randomUUID())]),
				false,
				null
			])
		).rejects.toThrow();
	});
});

describe('SupabaseComputeServerStore saves', () => {
	const KEY = Buffer.alloc(32, 7);
	const ctx = { userId: 'u' } as unknown as RequestContext;

	function bundle() {
		const rpc = vi.fn(async () => ({ data: null, error: null }));
		return { rpc, clients: { forRequest: () => ({ rpc }) } as unknown as ClientBundle };
	}

	it('sends a platform save as one call', async () => {
		const { rpc, clients } = bundle();
		const server: ComputeServerConfig = {
			id: 'a',
			scope: 'platform',
			sharedWith: ['org-1'],
			label: 'S',
			serverUrl: 'http://c'
		};
		await new SupabaseComputeServerStore(clients, KEY).savePlatformServers(ctx, [server], 'a');

		expect(rpc).toHaveBeenCalledOnce();
		expect(rpc).toHaveBeenCalledWith(
			'save_platform_compute_servers',
			expect.objectContaining({
				shares: [{ server_id: 'a', org_id: 'org-1' }],
				default_server: 'a'
			})
		);
	});

	it.each([
		[undefined, false, null],
		[null, true, null],
		['a', true, 'a']
	])('maps org default %s', async (defaultId, setDefault, value) => {
		const { rpc, clients } = bundle();
		await new SupabaseComputeServerStore(clients, KEY).saveOrgServers(ctx, 'org', [], defaultId);

		expect(rpc).toHaveBeenCalledWith('save_org_compute_servers', {
			o: 'org',
			servers: [],
			set_default: setDefault,
			default_server: value
		});
	});
});
