/**
 * Every file store does read-modify-write, so without a queue two writers start
 * from one snapshot and the later rename drops the earlier change. These force
 * overlap with `Promise.all`, so the counts are not field rates.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	SYSTEM_CONTEXT as S,
	type Invite,
	type OrgComputeServer,
	type PlatformProjectGrant,
	type ShareLink
} from '@selvajs/platform';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';
import { LocalInviteStore } from '../LocalInviteStore.js';
import { LocalPlatformProjectGrantStore } from '../LocalPlatformProjectGrantStore.js';
import { LocalShareLinkStore } from '../LocalShareLinkStore.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-write-race-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

const invite = (id: string, email: string): Invite =>
	({
		id,
		tokenHash: `hash-${id}`,
		email,
		orgId: 'acme',
		orgRole: 'member',
		orgPermissions: [],
		invitedBy: 'a',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		acceptedAt: null,
		acceptedByUserId: null
	}) as unknown as Invite;

const link = (id: string, over: Partial<ShareLink> = {}): ShareLink => ({
	id,
	definitionId: 'd',
	channel: 'live',
	tokenHash: `hash-${id}`,
	createdBy: 'u',
	createdAt: new Date().toISOString(),
	expiresAt: null,
	revokedAt: null,
	allowSolve: true,
	maxSolves: null,
	solveCount: 0,
	...over
});

describe('LocalInviteStore', () => {
	it('revoking by email does not lose to a create', async () => {
		const store = new LocalInviteStore(dir);
		await store.create(S, invite('leaver', 'leaver@x.io'));

		await Promise.all([
			store.revokePendingByEmail(S, 'acme', 'leaver@x.io'),
			store.create(S, invite('other', 'other@x.io'))
		]);

		const { items } = await store.listByOrg(S, 'acme', { limit: 50 });
		expect(items.map((i) => i.id)).toEqual(['other']);
	});

	it('keeps every concurrent create', async () => {
		const store = new LocalInviteStore(dir);
		await Promise.all(
			Array.from({ length: 20 }, (_, i) => store.create(S, invite(`i${i}`, `${i}@x.io`)))
		);
		expect((await store.listByOrg(S, 'acme', { limit: 50 })).items).toHaveLength(20);
	});
});

describe('LocalPlatformProjectGrantStore', () => {
	const grant = (id: string): PlatformProjectGrant =>
		({
			id,
			projectId: 'p',
			granteeType: 'user',
			granteeId: id,
			canSolve: true,
			createdBy: 'a',
			createdAt: new Date().toISOString()
		}) as PlatformProjectGrant;

	it('keeps every concurrent create', async () => {
		const store = new LocalPlatformProjectGrantStore(path.join(dir, 'grants.json'));
		await Promise.all(Array.from({ length: 20 }, (_, i) => store.create(S, grant(`g${i}`))));
		expect(await store.listByProject(S, 'p')).toHaveLength(20);
	});

	it('does not bring a revoked grant back', async () => {
		const store = new LocalPlatformProjectGrantStore(path.join(dir, 'grants.json'));
		await store.create(S, grant('doomed'));

		await Promise.all([store.delete(S, 'doomed'), store.create(S, grant('other'))]);

		const left = await store.listByProject(S, 'p');
		expect(left.map((g) => g.id)).toEqual(['other']);
	});
});

describe('LocalComputeServerStore', () => {
	it('keeps both orgs when they save at once', async () => {
		const store = new LocalComputeServerStore(path.join(dir, 'c.json'), Buffer.alloc(32, 1));
		const server = (id: string, ownerOrgId: string): OrgComputeServer => ({
			id,
			scope: 'org',
			ownerOrgId,
			label: id,
			serverUrl: 'http://c'
		});

		await Promise.all([
			store.saveOrgServers(S, 'a', [server('sa', 'a')]),
			store.saveOrgServers(S, 'b', [server('sb', 'b')])
		]);

		const { servers } = await store.getConfig(S);
		expect(servers.map((s) => s.id).sort()).toEqual(['sa', 'sb']);
	});
});

describe('LocalShareLinkStore', () => {
	const open = () => new LocalShareLinkStore({ filePath: path.join(dir, 'share-links.json') });

	it('holds the solve cap under concurrent increments', async () => {
		const store = open();
		await store.create(S, link('l', { maxSolves: 5 }));

		const results = await Promise.all(
			Array.from({ length: 20 }, () => store.tryIncrementSolveCount(S, 'l'))
		);

		expect(results.filter((r) => r !== null)).toHaveLength(5);
		expect((await store.getById(S, 'l'))?.solveCount).toBe(5);
	});

	it('keeps every concurrent create', async () => {
		const store = open();
		await Promise.all(Array.from({ length: 12 }, (_, i) => store.create(S, link(`l${i}`))));
		const { items } = await store.listByDefinition(S, 'd', { limit: 50 });
		expect(items).toHaveLength(12);
	});

	it('does not let a solve un-revoke a link', async () => {
		const store = open();
		await store.create(S, link('l'));

		await Promise.all([store.tryIncrementSolveCount(S, 'l'), store.revoke(S, 'l')]);

		expect((await store.getById(S, 'l'))?.revokedAt).not.toBeNull();
	});
});
