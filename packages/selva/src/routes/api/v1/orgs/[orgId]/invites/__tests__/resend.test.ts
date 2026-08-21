/**
 * Resend exists because the raw token is never stored — there is nothing to
 * re-read, so a resend must mint a replacement. What that must NOT do:
 *
 *   - leave the superseded link usable (it would double the live tokens)
 *   - re-derive grants from the caller's current standing, which would let a
 *     since-demoted admin quietly change what the invite carries
 *   - reach an invite belonging to another org
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedOrg,
	actAs,
	callHandler,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { createInvite, resendInvite } from '$lib/server/api/handlers/invites.js';
import { hashToken } from '$lib/server/invites/token.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

type TestLocals = Awaited<ReturnType<typeof actAs>>;

async function mint(orgId: string, locals: TestLocals, body: Record<string, unknown>) {
	const res = await callHandler(createInvite, { locals, params: { orgId }, body });
	expect(res.status).toBe(201);
	const json = res.json as { id: string; acceptUrl: string; delivery: string };
	return { ...json, token: new URL(json.acceptUrl).searchParams.get('token')! };
}

describe('POST /api/v1/orgs/{orgId}/invites/{id}/resend', () => {
	it('issues a new working token and kills the old one', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const original = await mint(acme.id, locals, {
			email: 'newhire@acme.test',
			orgRole: 'member',
			permissions: []
		});

		const res = await callHandler(resendInvite, {
			locals,
			params: { orgId: acme.id, id: original.id }
		});
		expect(res.status).toBe(201);
		const body = res.json as { id: string; acceptUrl: string; tokenHash?: unknown };
		const newToken = new URL(body.acceptUrl).searchParams.get('token')!;

		// A genuinely different token, and the response still never echoes the hash.
		expect(newToken).not.toBe(original.token);
		expect(newToken).toMatch(/^invite_/);
		expect(body.tokenHash).toBeUndefined();

		const store = tp.config.data.invites;
		await expect(store.getByTokenHash(SYSTEM_CONTEXT, hashToken(newToken))).resolves.not.toBeNull();
		// The superseded link must be dead the moment resend returns.
		await expect(
			store.getByTokenHash(SYSTEM_CONTEXT, hashToken(original.token))
		).resolves.toBeNull();
	});

	it('copies the original grants rather than re-deriving them', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const original = await mint(acme.id, locals, {
			email: 'scoped@acme.test',
			orgRole: 'member',
			permissions: ['manage_projects']
		});

		const res = await callHandler(resendInvite, {
			locals,
			params: { orgId: acme.id, id: original.id }
		});
		const body = res.json as {
			email: string;
			orgRole: string;
			orgPermissions: string[];
		};
		expect(body.email).toBe('scoped@acme.test');
		expect(body.orgRole).toBe('member');
		expect(body.orgPermissions).toEqual(['manage_projects']);
	});

	it('refuses an invite belonging to another org', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);
		const other = await seedOrg(tp, {
			name: 'Other Co',
			slug: 'other-co',
			ownerId: alice.id
		});

		const original = await mint(acme.id, locals, {
			email: 'newhire@acme.test',
			orgRole: 'member',
			permissions: []
		});

		const res = await callHandler(resendInvite, {
			locals,
			params: { orgId: other.id, id: original.id }
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});
