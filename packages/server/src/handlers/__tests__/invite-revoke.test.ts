import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT, narrowApiTokenContext, type Invite } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	actAs,
	callHandler,
	seedAcme,
	seedBigClient,
	type ActingLocals
} from '../../testing/index.js';
import { revokeInvite } from '../invites.js';

let h: HandlerHarness | null = null;

afterEach(async () => {
	await h?.cleanup();
	h = null;
});

async function seedInvite(orgId: string, invitedBy: string): Promise<Invite> {
	const invite: Invite = {
		id: randomUUID(),
		tokenHash: `hash-${randomUUID()}`,
		email: `${randomUUID()}@invitee.test`,
		orgId,
		orgRole: 'member',
		orgPermissions: [],
		platformPermissions: [],
		invitedBy,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 86_400_000).toISOString()
	};
	await h!.config.data.invites.create(SYSTEM_CONTEXT, invite);
	return invite;
}

async function storedInvite(orgId: string, id: string): Promise<Invite | undefined> {
	const page = await h!.config.data.invites.listByOrg(SYSTEM_CONTEXT, orgId);
	return page.items.find((i) => i.id === id);
}

const revoke = (locals: unknown, orgId: string, id: string) =>
	callHandler(revokeInvite, { locals, params: { orgId, id }, method: 'DELETE' });

function withKey(locals: ActingLocals): ActingLocals {
	return {
		...locals,
		ctx: narrowApiTokenContext(locals.ctx, {
			id: 'key-1',
			orgId: locals.ctx.actingOrgId!,
			scopes: ['write:all'],
			expiresAt: '2099-01-01T00:00:00.000Z'
		})
	};
}

async function world() {
	h = await freshHarness();
	return { ...(await seedAcme(h)), ...(await seedBigClient(h)) };
}

describe('DELETE /orgs/{orgId}/invites/{id}', () => {
	it('lets an org admin revoke a pending invite', async () => {
		const w = await world();
		const invite = await seedInvite(w.acme.id, w.alice.id);
		const res = await revoke(await actAs(h!, w.alice.id), w.acme.id, invite.id);
		expect(res.status).toBe(204);
		expect(await storedInvite(w.acme.id, invite.id)).toBeUndefined();
		expect(h!.events).toContainEqual(
			expect.objectContaining({ type: 'invite.revoked', inviteId: invite.id })
		);
	});

	it('refuses a member without manage_org_members', async () => {
		const w = await world();
		const invite = await seedInvite(w.acme.id, w.alice.id);
		const res = await revoke(await actAs(h!, w.bob.id), w.acme.id, invite.id);
		expect(res.status).toBe(403);
		expect(await storedInvite(w.acme.id, invite.id)).toBeDefined();
	});

	// The URL org matches the acting org, so only the ownership lookup stands
	// between the admin and an invite the store would revoke by id alone.
	it('answers 404 for another org’s invite named under the caller’s own org', async () => {
		const w = await world();
		await seedInvite(w.acme.id, w.alice.id);
		const foreign = await seedInvite(w.bigClient.id, w.carol.id);
		const res = await revoke(await actAs(h!, w.alice.id), w.acme.id, foreign.id);
		expect(res.status).toBe(404);
		expect(await storedInvite(w.bigClient.id, foreign.id)).toBeDefined();
	});

	it('refuses an admin naming another org in the URL', async () => {
		const w = await world();
		const foreign = await seedInvite(w.bigClient.id, w.carol.id);
		const res = await revoke(await actAs(h!, w.alice.id), w.bigClient.id, foreign.id);
		expect(res.status).toBe(403);
		expect(await storedInvite(w.bigClient.id, foreign.id)).toBeDefined();
	});

	it('keeps an accepted invite: consuming one is history, not a live grant', async () => {
		const w = await world();
		const invite = await seedInvite(w.acme.id, w.alice.id);
		await h!.config.data.invites.markAccepted(SYSTEM_CONTEXT, invite.id, w.bob.id);
		const res = await revoke(await actAs(h!, w.alice.id), w.acme.id, invite.id);
		expect(res.status).toBe(204);
		expect(await storedInvite(w.acme.id, invite.id)).toMatchObject({
			acceptedByUserId: w.bob.id
		});
		expect(h!.events.some((e) => e.type === 'invite.revoked')).toBe(false);
	});

	// Revoking only removes access, so a key may do it.
	it('lets a write key whose owner holds manage_org_members revoke, and refuses one whose owner does not', async () => {
		const w = await world();
		const invite = await seedInvite(w.acme.id, w.alice.id);
		const member = await revoke(withKey(await actAs(h!, w.bob.id)), w.acme.id, invite.id);
		expect(member.status).toBe(403);
		expect(await storedInvite(w.acme.id, invite.id)).toBeDefined();

		const admin = await revoke(withKey(await actAs(h!, w.alice.id)), w.acme.id, invite.id);
		expect(admin.status).toBe(204);
		expect(await storedInvite(w.acme.id, invite.id)).toBeUndefined();
	});
});
