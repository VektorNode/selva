/**
 * Changing or removing an org member is session-only, like invites and token
 * management: a leaver's surviving owner key must not demote co-owners.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseApiScope, SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedUser, seedOrgMember, actAs, callHandler } from '../../testing/index.js';
import { removeOrgMember, updateOrgMember } from '../orgMembers.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

async function ownerKey() {
	tp = await freshHarness();
	const { acme, alice } = await seedAcme(tp);
	const owner = await seedUser(tp, 'owner@acme.test');
	await seedOrgMember(tp, { orgId: acme.id, userId: owner.id, role: 'owner' });
	const locals = await actAs(tp, owner.id);
	locals.ctx = {
		...locals.ctx!,
		platformPermissions: [],
		apiScope: { tokenId: 't', scopes: [parseApiScope('write:all')!], expiresAt: '' }
	};
	return { acme, alice, locals };
}

describe('org member routes with an API key', () => {
	it('refuses a role change', async () => {
		const { acme, alice, locals } = await ownerKey();
		const res = await callHandler(updateOrgMember, {
			locals,
			params: { orgId: acme.id, userId: alice.id },
			body: { role: 'member' }
		});
		expect(res.status).toBe(403);
		const after = await tp!.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, alice.id);
		expect(after?.role).toBe('admin');
	});

	it('refuses a removal', async () => {
		const { acme, alice, locals } = await ownerKey();
		const res = await callHandler(removeOrgMember, {
			locals,
			method: 'DELETE',
			params: { orgId: acme.id, userId: alice.id }
		});
		expect(res.status).toBe(403);
		expect(
			await tp!.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, alice.id)
		).not.toBeNull();
	});
});
