/**
 * Share-link handlers through the binding.
 *
 * The load-bearing assertion is that `tokenHash` never reaches a client. The
 * store record carries it, `forClient` does not strip it, and the response
 * schema is the only thing that does — so a handler returning `{ body: link }`
 * instead of `shaped(...)` puts a credential hash on the wire with no type
 * error and no other test failing. These assert on the serialized body, not on
 * what the handler passed in.
 *
 * The `ENABLE_SHARING` gate is the second: it must read the *request's* flag,
 * not the module global, or a second host's flag setting is ignored.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '../sveltekit.js';
import { createShareLink, listShareLinks, revokeShareLink } from '@selvajs/server/handlers';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedProjectMember,
	seedShareLink,
	actAs,
	call,
	type TestProviders
} from '../../__tests__/fixtures.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

/** Sharing is off by default in `freshProviders`; these routes 404 without it. */
async function sharingEnabled() {
	return await freshProviders({ flags: { ENABLE_SHARING: true } });
}

async function ownedDefinition() {
	const { alice, bob, alicesPrivate } = await seedAcme(tp);
	await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
	const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	return { alice, bob, def };
}

describe('POST share-links', () => {
	it('returns the raw token once and never the token hash', async () => {
		tp = await sharingEnabled();
		const { alice, def } = await ownedDefinition();

		const res = await call(mount('Failed to create share link', createShareLink), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});

		expect(res.status).toBe(201);
		const body = res.json as { link: Record<string, unknown>; token: string };
		expect(body.token).toBeTypeOf('string');
		expect(body.link.hasToken).toBe(true);
		// The whole reason these responses go through a schema.
		expect(body.link).not.toHaveProperty('tokenHash');
		expect(JSON.stringify(body)).not.toContain('tokenHash');
	});

	it('applies the default solve cap only when maxSolves is absent', async () => {
		tp = await sharingEnabled();
		const { alice, def } = await ownedDefinition();

		const defaulted = await call(mount('Failed to create share link', createShareLink), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});
		expect(
			(defaulted.json as { link: { maxSolves: number | null } }).link.maxSolves
		).toBeGreaterThan(0);

		// An explicit null is a deliberate "uncap" and must survive.
		const uncapped = await call(mount('Failed to create share link', createShareLink), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true, maxSolves: null }
		});
		expect((uncapped.json as { link: { maxSolves: number | null } }).link.maxSolves).toBeNull();
	});

	it('rejects a non-editor with 403', async () => {
		tp = await sharingEnabled();
		const { bob, def } = await ownedDefinition();

		const res = await call(mount('Failed to create share link', createShareLink), {
			locals: await actAs(tp, bob.id),
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});

		expect(res.status).toBe(403);
	});
});

describe('GET share-links', () => {
	it('lists links without leaking token hashes', async () => {
		tp = await sharingEnabled();
		const { alice, def } = await ownedDefinition();
		await seedShareLink(tp, { definitionId: def.record.guid, createdBy: alice.id });

		const res = await call(mount('Failed to list share links', listShareLinks), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(200);
		const body = res.json as { items: Record<string, unknown>[] };
		expect(body.items.length).toBeGreaterThan(0);
		expect(JSON.stringify(body)).not.toContain('tokenHash');
	});
});

describe('DELETE share-links/[linkId]', () => {
	it('revokes a link belonging to the definition', async () => {
		tp = await sharingEnabled();
		const { alice, def } = await ownedDefinition();
		const seeded = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id
		});

		const locals = await actAs(tp, alice.id);
		const res = await call(mount('Failed to revoke share link', revokeShareLink), {
			locals,
			params: { guid: def.record.guid, linkId: seeded.link.id }
		});

		expect(res.status).toBe(204);
		const after = await tp.config.data.shareLinks.getById(locals.ctx, seeded.link.id);
		// A handler that guards correctly then forgets the write still 204s.
		expect(after?.revokedAt).toBeTruthy();
	});

	it('404s for a link belonging to a different definition', async () => {
		tp = await sharingEnabled();
		const { alice, def } = await ownedDefinition();
		const other = await seedDefinition(tp, {
			projectId: def.record.projectId,
			ownerId: alice.id
		});
		const foreign = await seedShareLink(tp, {
			definitionId: other.record.guid,
			createdBy: alice.id
		});

		const res = await call(mount('Failed to revoke share link', revokeShareLink), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid, linkId: foreign.link.id }
		});

		// Never disclose that the id exists on another definition.
		expect(res.status).toBe(404);
	});
});

describe('ENABLE_SHARING gate', () => {
	it('404s every share-link route when the request’s flag is off', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();
		const locals = await actAs(tp, alice.id);

		const list = await call(mount('Failed to list share links', listShareLinks), {
			locals,
			params: { guid: def.record.guid }
		});
		const create = await call(mount('Failed to create share link', createShareLink), {
			locals,
			params: { guid: def.record.guid },
			body: { channel: 'live', allowSolve: true }
		});

		// Reads `req.deps.flag`, not the module global — a second host with
		// sharing off must not serve these.
		expect(list.status).toBe(404);
		expect(create.status).toBe(404);
	});
});
