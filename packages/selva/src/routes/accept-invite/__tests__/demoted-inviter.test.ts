/**
 * An invite hands out what its sender held at mint time. Without a re-check at
 * acceptance, an owner about to be demoted parks the role in an invite to a
 * second address and takes it back after the demotion.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { findAuthUserByEmail } from '@selvajs/server/providers';
import {
	actAs,
	call,
	freshProviders,
	seedAcme,
	seedUser,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { POST as mintInvite } from '../../api/v1/orgs/[orgId]/invites/+server.js';
import { actions } from '../+page.server.js';

let tp: TestProviders | null = null;
afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

function accept(token: string) {
	const form = new FormData();
	form.set('token', token);
	form.set('password', 'correct-horse-battery');
	form.set('confirm', 'correct-horse-battery');
	return actions
		.default({
			request: new Request('http://test.local/accept-invite', { method: 'POST', body: form }),
			cookies: { get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] },
			locals: { log: { error: () => {}, warn: () => {}, info: () => {} } }
		} as never)
		.catch((thrown: unknown) => thrown);
}

describe('accept-invite after the inviter lost what the invite carries', () => {
	it('refuses an owner + instance_admin invite once its sender holds neither', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const data = tp.config.data;
		await data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, alice.id, 'owner');
		await data.permissions.set(SYSTEM_CONTEXT, alice.id, ['instance_admin']);
		// A second admin, so revoking alice's grant below is not the last-admin case.
		await seedUser(tp, 'root@ops.test', ['instance_admin']);

		const minted = await call(mintInvite, {
			locals: await actAs(tp, alice.id),
			params: { orgId: acme.id },
			body: { email: 'alt@alice.test', orgRole: 'owner', permissions: ['instance_admin'] }
		});
		expect(minted.status).toBe(201);
		const token = new URL((minted.json as { acceptUrl: string }).acceptUrl).searchParams.get(
			'token'
		)!;

		expect(await data.permissions.set(SYSTEM_CONTEXT, alice.id, [])).toBe('ok');
		await data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, alice.id, 'member');

		const result = (await accept(token)) as { status?: number };

		expect(result?.status).toBe(410);
		expect(await findAuthUserByEmail(tp.config.auth, 'alt@alice.test')).toBeNull();
	});
});
