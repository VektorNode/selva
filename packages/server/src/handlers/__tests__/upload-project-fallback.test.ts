/**
 * With no `projectId` in the body the upload route picks a project on the
 * caller's behalf. It used to take the first row of
 * `listProjects(ctx, actingOrgId)`, which the local provider does not filter by
 * ctx — so the pick could land on a `private` project the caller is not a
 * member of. `requireCanCreateDefinition` catches that (403) except on an
 * `autoJoinOnUpload` project, whose commons branch admits any authenticated
 * user; there the upload lands somewhere the caller never named.
 *
 * The fallback now resolves from the caller's `canView`-filtered set, so an
 * invisible project is not a candidate in the first place.
 *
 * These tests stop at project selection: a successful upload additionally needs
 * a live Rhino.Compute to extract the schema.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	seedUser,
	seedOrg,
	seedOrgMember,
	seedProject,
	actAs,
	callHandler
} from '../../testing/index.js';
import { createDefinition } from '../definitions.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** Multipart body with a .gh file and no `projectId`. */
function uploadForm(): FormData {
	const form = new FormData();
	form.set('file', new File([new Uint8Array([1, 2, 3])], 'test.gh'), 'test.gh');
	form.set('displayName', 'Fallback Upload');
	return form;
}

function callUpload(locals: unknown): Promise<{ status: number }> {
	return callHandler(createDefinition, {
		locals,
		url: 'http://test.local/api/v1/definitions',
		body: uploadForm()
	});
}

describe('POST /api/v1/definitions — implicit project fallback', () => {
	it('refuses when the org has no project the caller can see', async () => {
		tp = await freshHarness();

		// Carol is an org member, but the org's only project is private and owned
		// by someone else — she is not a member of it.
		const alice = await seedUser(tp, 'alice@acme.test');
		const carol = await seedUser(tp, 'carol@acme.test');
		const acme = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: acme.id, userId: alice.id, role: 'owner' });
		await seedOrgMember(tp, { orgId: acme.id, userId: carol.id, role: 'member' });
		await seedProject(tp, {
			orgId: acme.id,
			name: 'Alice Private',
			slug: 'alice-private',
			ownerId: alice.id,
			visibility: 'private',
			// The trap: on this project `canCreateDefinition` admits any
			// authenticated user, so an invisible pick would have been *accepted*.
			autoJoinOnUpload: true
		});

		const locals = await actAs(tp, carol.id);
		const res = await callUpload(locals);

		// 400 (no candidate), not a silent upload into Alice's private project.
		expect(res.status).toBe(400);
	});

	it('does not pick a project belonging to a different org', async () => {
		tp = await freshHarness();

		const alice = await seedUser(tp, 'alice@acme.test');
		const acme = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: acme.id, userId: alice.id, role: 'owner' });

		// A visible project — but in an org Alice is not currently acting as.
		const other = await seedOrg(tp, { name: 'Other', slug: 'other', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: other.id, userId: alice.id, role: 'owner' });
		await seedProject(tp, {
			orgId: other.id,
			name: 'Elsewhere',
			slug: 'elsewhere',
			ownerId: alice.id,
			visibility: 'private'
		});

		const locals = await actAs(tp, alice.id);
		// Act as Acme, which has no projects at all.
		(locals as { ctx: { actingOrgId?: string } }).ctx.actingOrgId = acme.id;

		const res = await callUpload(locals);

		expect(res.status).toBe(400);
	});
});
