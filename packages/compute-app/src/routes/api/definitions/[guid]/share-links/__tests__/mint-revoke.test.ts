/**
 * Spec §7 — share-link mint / list / revoke route lifecycle.
 *
 * Verifies:
 *   - POST returns the raw token exactly once and never again
 *   - GET only exposes tokenHash-stripped metadata (no plaintext)
 *   - DELETE soft-deletes (revoked links stop appearing in list)
 *   - Default `maxSolves` cap is applied when omitted; explicit `null` removes it
 *   - Authorization: container editor + commons def-owner can mint, random user 403
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedCommons,
	seedDefinition,
	seedProjectMember,
	actAs,
	call,
	type TestProviders
} from '../../../../../../lib/server/__tests__/fixtures.js';
import { GET, POST } from '../+server.js';
import { DELETE } from '../[linkId]/+server.js';
import { DEFAULT_SHARE_LINK_MAX_SOLVES } from '@selva/platform';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('POST /api/definitions/[guid]/share-links', () => {
	it('returns raw token in response; default cap applied', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals: aliceLocals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		expect(res.status).toBe(201);
		const body = res.json as {
			link: { id: string; maxSolves: number };
			token: string;
		};
		expect(body.token).toMatch(/^share_/);
		expect(body.link.maxSolves).toBe(DEFAULT_SHARE_LINK_MAX_SOLVES);
	});

	it('explicit maxSolves: null removes the cap', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals: aliceLocals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true, maxSolves: null }
		});
		expect(res.status).toBe(201);
		const body = res.json as { link: { maxSolves: number | null } };
		expect(body.link.maxSolves).toBeNull();
	});

	it('GET strips tokenHash from list responses', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		await call(POST, {
			locals: aliceLocals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});

		const list = await call(GET, { locals: aliceLocals, params: { guid: def.record.guid } });
		expect(list.status).toBe(200);
		const body = list.json as { links: Array<Record<string, unknown>> };
		expect(body.links.length).toBe(1);
		expect(body.links[0]).not.toHaveProperty('tokenHash');
		expect(body.links[0]).toHaveProperty('hasToken', true);
	});

	it('Bob (Acme member, no project membership) — 403', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const bobLocals = await actAs(tp, bob.id);

		const res = await call(POST, {
			locals: bobLocals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		expect(res.status).toBe(403);
	});

	it('Commons mode: Alice (definition owner) can mint on her own def', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { alicesCommonsDef } = await seedCommons(tp, { acmeId: acme.id, aliceId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals: aliceLocals,
			params: { guid: alicesCommonsDef.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		expect(res.status).toBe(201);
	});

	it('Commons mode: Peter (random user) cannot mint on Alice\'s def', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { alicesCommonsDef, peter } = await seedCommons(tp, {
			acmeId: acme.id,
			aliceId: alice.id
		});
		const peterLocals = await actAs(tp, peter.id);

		const res = await call(POST, {
			locals: peterLocals,
			params: { guid: alicesCommonsDef.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		expect(res.status).toBe(403);
	});

	it('Project editor (non-owner) can mint in container mode', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: bob.id,
			role: 'editor'
		});
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const bobLocals = await actAs(tp, bob.id);

		const res = await call(POST, {
			locals: bobLocals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		expect(res.status).toBe(201);
	});
});

describe('DELETE /api/definitions/[guid]/share-links/[linkId]', () => {
	it('revoking removes link from subsequent GET list', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		const mint = await call(POST, {
			locals: aliceLocals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		const linkId = (mint.json as { link: { id: string } }).link.id;

		const del = await call(DELETE, {
			locals: aliceLocals,
			params: { guid: def.record.guid, linkId }
		});
		expect(del.status).toBe(200);

		const list = await call(GET, { locals: aliceLocals, params: { guid: def.record.guid } });
		const body = list.json as { links: Array<unknown> };
		expect(body.links).toHaveLength(0);
	});

	it('revoking a link that belongs to a different definition → 404', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const defA = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const defB = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		const mint = await call(POST, {
			locals: aliceLocals,
			params: { guid: defA.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		const linkId = (mint.json as { link: { id: string } }).link.id;

		// linkId belongs to defA; we ask DELETE against defB.
		const del = await call(DELETE, {
			locals: aliceLocals,
			params: { guid: defB.record.guid, linkId }
		});
		expect(del.status).toBe(404);
	});
});
