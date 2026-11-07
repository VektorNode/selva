import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { actAs, anon, callHandler, seedAcme, seedDefinition } from '../../testing/index.js';
import { starDefinition, unstarDefinition } from '../me.starred.js';

let h: HandlerHarness | null = null;

afterEach(async () => {
	await h?.cleanup();
	h = null;
});

async function starsOf(userId: string): Promise<string[]> {
	return (
		(await h!.config.data.userProfile.getProfile(SYSTEM_CONTEXT, userId))?.starredDefinitions ?? []
	);
}

const star = (locals: unknown, guid: string) =>
	callHandler(starDefinition, { locals, params: { guid }, method: 'PUT' });

describe('PUT/DELETE /me/starred/{guid}', () => {
	it('refuses an anonymous caller', async () => {
		h = await freshHarness();
		const res = await star(anon(h), randomUUID());
		expect(res.status).toBe(401);
	});

	// No visibility check: the read paths filter stars by visibility, so the
	// only thing to protect here is whether a guid exists.
	it('answers a definition the caller cannot see exactly like one that does not exist', async () => {
		h = await freshHarness();
		const { alice, bob, alicesPrivate } = await seedAcme(h);
		const { record } = await seedDefinition(h, { projectId: alicesPrivate.id, ownerId: alice.id });
		const bobLocals = await actAs(h, bob.id);

		const hidden = await star(bobLocals, record.guid);
		const missing = await star(bobLocals, randomUUID());
		expect(hidden.status).toBe(204);
		expect({ ...missing, headers: undefined }).toEqual({ ...hidden, headers: undefined });
	});

	it('changes only the caller’s own stars', async () => {
		h = await freshHarness();
		const { alice, bob } = await seedAcme(h);
		const guid = randomUUID();

		expect((await star(await actAs(h, bob.id), guid)).status).toBe(204);
		expect(await starsOf(bob.id)).toEqual([guid]);
		expect(await starsOf(alice.id)).toEqual([]);

		const res = await callHandler(unstarDefinition, {
			locals: await actAs(h, alice.id),
			params: { guid },
			method: 'DELETE'
		});
		expect(res.status).toBe(204);
		expect(await starsOf(bob.id)).toEqual([guid]);
	});
});
