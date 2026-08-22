/**
 * Commons edit rights used to outlive membership: `canEditDefinition`'s
 * commons branch matched `userId === definition.ownerId` and nothing else.
 * `ownerId` is stamped at upload and never revisited, so it records who
 * uploaded, not who still belongs — a contributor removed from the org kept
 * edit, delete and share-link authority over everything they had ever
 * uploaded, and flipping `autoJoinOnUpload` on handed that back retroactively
 * to every past uploader at once.
 *
 * Commons now grants edit on top of belonging: the rule also requires a live
 * org membership.
 *
 * These run through `requireCanEditDefinition` rather than the rule directly
 * — the rule's own cases live in the local provider's `rules.test.ts`. What's
 * only testable here is that the guard actually loads the membership row and
 * hands it to the rule; a rule reading a field nobody populates would pass
 * every unit test and deny everyone in production.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedCommons,
	seedProjectMember,
	seedDefinition,
	actAs,
	expectHttpError,
	type TestProviders
} from './fixtures.js';
import { requireCanEditDefinition } from '../access.server.js';

let tp: TestProviders | null = null;

/** Store-level ctx for seeding and offboarding — bypasses the route guards. */
function adminCtx(userId: string, orgId: string): RequestContext {
	return {
		userId,
		actingOrgId: orgId,
		platformPermissions: ['instance_admin'],
		orgPermissions: []
	};
}

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('commons edit rights require current org membership', () => {
	it('lets a definition owner who is still an org member edit their own', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const { commonsProject } = await seedCommons(tp, { acmeId: acme.id, aliceId: alice.id });

		// Bob holds no project role — the commons branch is the only thing that
		// can pass him, so this is the positive control for the whole feature.
		const bobsDef = await seedDefinition(tp, {
			projectId: commonsProject.id,
			ownerId: bob.id,
			displayName: "Bob's contribution"
		});

		await expect(
			requireCanEditDefinition(await actAs(tp, bob.id), commonsProject.id, bobsDef.record.guid)
		).resolves.toBeDefined();
	});

	it('refuses the same edit once the uploader has left the org', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const { commonsProject } = await seedCommons(tp, { acmeId: acme.id, aliceId: alice.id });
		const bobsDef = await seedDefinition(tp, {
			projectId: commonsProject.id,
			ownerId: bob.id,
			displayName: "Bob's contribution"
		});

		// Offboarding, nothing more. `bobsDef.ownerId` still says Bob, which is
		// the whole point: history is not authority.
		await tp.config.data.orgs.removeOrgMember(adminCtx(alice.id, acme.id), acme.id, bob.id);

		await expectHttpError(
			requireCanEditDefinition(await actAs(tp, bob.id), commonsProject.id, bobsDef.record.guid),
			403
		);
	});

	it('keeps a departed uploader out even after the commons flag is flipped on', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);

		// The retroactive case, in order: container project first, Bob uploads as
		// a project editor, Bob leaves, and only then does an admin turn commons
		// on for unrelated reasons. Before the fix that last step alone restored
		// his edit rights.
		const ctx = adminCtx(alice.id, acme.id);
		const { commonsProject } = await seedCommons(tp, { acmeId: acme.id, aliceId: alice.id });
		await tp.config.data.projects.updateProject(ctx, commonsProject.id, {
			autoJoinOnUpload: false
		});
		await seedProjectMember(tp, {
			projectId: commonsProject.id,
			userId: bob.id,
			role: 'editor'
		});
		const bobsDef = await seedDefinition(tp, {
			projectId: commonsProject.id,
			ownerId: bob.id,
			displayName: "Bob's contribution"
		});

		await tp.config.data.projects.removeProjectMember(ctx, commonsProject.id, bob.id);
		await tp.config.data.orgs.removeOrgMember(ctx, acme.id, bob.id);
		await tp.config.data.projects.updateProject(ctx, commonsProject.id, {
			autoJoinOnUpload: true
		});

		await expectHttpError(
			requireCanEditDefinition(await actAs(tp, bob.id), commonsProject.id, bobsDef.record.guid),
			403
		);
	});

	it('does not consult org membership on a container project', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);

		// Container mode reads project role and nothing else. Bob holds a project
		// editor row without a live org membership — a state `removeOrgMember`
		// cannot produce (it cascades project rows), so it is seeded in that
		// order deliberately. The new check must not leak out of the commons
		// branch and revoke him.
		await tp.config.data.orgs.removeOrgMember(adminCtx(alice.id, acme.id), acme.id, bob.id);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: bob.id, role: 'editor' });
		const def = await seedDefinition(tp, {
			projectId: alicesPrivate.id,
			ownerId: alice.id,
			displayName: "Alice's def"
		});

		await expect(
			requireCanEditDefinition(await actAs(tp, bob.id), alicesPrivate.id, def.record.guid)
		).resolves.toBeDefined();
	});
});
