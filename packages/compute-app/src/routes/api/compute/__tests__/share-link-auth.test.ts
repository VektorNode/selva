/**
 * Spec §7 — share-link parallel auth path.
 *
 * `tryResolveShareToken` is the single source of truth for token-based access.
 * Once it returns a `ResolvedShareLink`, the request proceeds with a synthetic
 * ctx scoped to (definitionId, channel) — user-based rules are skipped. These
 * tests verify every failure path returns the right HTTP status without
 * leaking access.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server.js';
import { SYSTEM_CONTEXT } from '@selva/platform';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

function reqWithToken(token: string | null): { request: Request; url: URL } {
	const url = new URL(
		token ? `http://test.local/?token=${encodeURIComponent(token)}` : 'http://test.local/'
	);
	return { request: new Request(url.toString()), url };
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
	try {
		await promise;
	} catch (err) {
		const e = err as { status?: number; body?: { message?: string } };
		expect(e.status).toBe(status);
		return;
	}
	throw new Error(`expected throw with status ${status}, but resolved`);
}

describe('share-link token resolution', () => {
	it('valid token + matching definition + matching channel → resolves', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken, link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			channel: 'live'
		});

		const { request, url } = reqWithToken(rawToken);
		const resolved = await tryResolveShareToken(request, url, def.record.guid, 'live', {
			requireSolve: true
		});
		expect(resolved).not.toBeNull();
		expect(resolved!.link.id).toBe(link.id);
		expect(resolved!.ctx.actingOrgId).toBe(alicesPrivate.orgId);
		expect(resolved!.ctx.userId).toBe('');
	});

	it('no token at all → returns null (caller falls through to user auth)', async () => {
		tp = await freshProviders();
		const { request, url } = reqWithToken(null);

		const resolved = await tryResolveShareToken(request, url, 'any-def-id', 'live', {
			requireSolve: true
		});
		expect(resolved).toBeNull();
	});

	it('token for definition A used against definition B → 403', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const defA = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const defB = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken } = await seedShareLink(tp, {
			definitionId: defA.record.guid,
			createdBy: alice.id
		});

		const { request, url } = reqWithToken(rawToken);
		await expectStatus(
			tryResolveShareToken(request, url, defB.record.guid, 'live', { requireSolve: true }),
			403
		);
	});

	it('token for live channel used against ?channel=draft → 403', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			channel: 'live'
		});

		const { request, url } = reqWithToken(rawToken);
		await expectStatus(
			tryResolveShareToken(request, url, def.record.guid, 'draft', { requireSolve: true }),
			403
		);
	});

	it('view-only token used on a solve-required path → 403', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			allowSolve: false
		});

		const { request, url } = reqWithToken(rawToken);
		await expectStatus(
			tryResolveShareToken(request, url, def.record.guid, 'live', { requireSolve: true }),
			403
		);
	});

	it('view-only token on a view path (requireSolve=false) → resolves', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			allowSolve: false
		});

		const { request, url } = reqWithToken(rawToken);
		const resolved = await tryResolveShareToken(request, url, def.record.guid, 'live', {
			requireSolve: false
		});
		expect(resolved).not.toBeNull();
		expect(resolved!.link.allowSolve).toBe(false);
	});

	it('revoked token → 401', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken, link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id
		});
		await tp.config.data.shareLinks.revoke(SYSTEM_CONTEXT, link.id);

		const { request, url } = reqWithToken(rawToken);
		await expectStatus(
			tryResolveShareToken(request, url, def.record.guid, 'live', { requireSolve: true }),
			401
		);
	});

	it('expired token → 401', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const past = new Date(Date.now() - 60_000).toISOString();
		const { rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			expiresAt: past
		});

		const { request, url } = reqWithToken(rawToken);
		await expectStatus(
			tryResolveShareToken(request, url, def.record.guid, 'live', { requireSolve: true }),
			401
		);
	});

	it('token whose parent definition was soft-deleted → 401 (fail closed)', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id
		});
		await tp.config.data.definitions.delete(SYSTEM_CONTEXT, def.record.guid);

		const { request, url } = reqWithToken(rawToken);
		await expectStatus(
			tryResolveShareToken(request, url, def.record.guid, 'live', { requireSolve: true }),
			401
		);
	});

	it('garbage token (well-formed prefix, no matching hash) → 401', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const { request, url } = reqWithToken('share_thisisnotreal');
		await expectStatus(
			tryResolveShareToken(request, url, def.record.guid, 'live', { requireSolve: true }),
			401
		);
	});
});
