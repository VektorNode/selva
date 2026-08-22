/**
 * The project and membership handlers, exercised through the SvelteKit binding.
 *
 * Two classes of behaviour here fail silently if they regress:
 *
 * - **404-not-403 on a project the caller cannot view.** A 403 confirms the id
 *   exists to anyone probing. Both statuses are "denied" to a careless test.
 * - **Owner-count preconditions.** A sole owner who demotes themselves locks the
 *   project — `canManage`, `canEditProjectSettings` and `canEdit` all go false
 *   at once, and no later request can undo it. The demote path is the one that
 *   is easy to leave out, because DELETE is the obvious place to guard.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '../sveltekit.js';
import { getProject, updateProject, deleteProject } from '@selvajs/server/handlers';
import {
	addProjectMember,
	listProjectMembers,
	removeProjectMember,
	updateProjectMemberRole
} from '@selvajs/server/handlers';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	seedProjectMember,
	actAs,
	call,
	spyOnStore,
	type TestProviders
} from '../../__tests__/fixtures.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

describe('GET /api/v1/projects/[id]', () => {
	it('returns the project with the caller’s effective capabilities', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: alice.id,
			role: 'owner'
		});

		const res = await call(mount('Failed to load project', getProject), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id }
		});

		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({
			id: alicesPrivate.id,
			role: 'owner',
			canEdit: true,
			canSolve: true
		});
	});

	it('returns 404, not 403, for a private project in another org', async () => {
		tp = await freshProviders();
		const { alicesPrivate } = await seedAcme(tp);
		const { carol } = await seedBigClient(tp);

		const res = await call(mount('Failed to load project', getProject), {
			locals: await actAs(tp, carol.id),
			params: { id: alicesPrivate.id }
		});

		// A 403 here would confirm the id exists. The two are indistinguishable
		// unless the status is asserted exactly.
		expect(res.status).toBe(404);
	});

	it('returns 404 for an id that does not exist', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		const res = await call(mount('Failed to load project', getProject), {
			locals: await actAs(tp, alice.id),
			params: { id: 'no-such-project' }
		});

		expect(res.status).toBe(404);
	});
});

describe('project member owner-count guards', () => {
	/** Seed a project whose sole owner is Alice, plus Bob as a viewer. */
	async function soleOwnerProject() {
		const acme = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: acme.alicesPrivate.id,
			userId: acme.alice.id,
			role: 'owner'
		});
		await seedProjectMember(tp, {
			projectId: acme.alicesPrivate.id,
			userId: acme.bob.id,
			role: 'viewer'
		});
		return acme;
	}

	it('refuses to demote the sole owner', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await soleOwnerProject();

		const res = await call(mount('Failed to update role', updateProjectMemberRole), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: alice.id },
			body: { role: 'viewer' }
		});

		expect(res.status).toBe(409);
		expect((res.json as { message: string }).message).toMatch(/sole owner/i);
	});

	it('refuses to remove the sole owner', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await soleOwnerProject();

		const res = await call(mount('Failed to remove member', removeProjectMember), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: alice.id }
		});

		expect(res.status).toBe(409);
		expect((res.json as { message: string }).message).toMatch(/sole owner/i);
	});

	it('demotes a co-owner only with ?confirm=true', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await soleOwnerProject();
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: bob.id,
			role: 'owner'
		});

		const unconfirmed = await call(mount('Failed to update role', updateProjectMemberRole), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: bob.id },
			body: { role: 'viewer' }
		});
		expect(unconfirmed.status).toBe(409);
		expect((unconfirmed.json as { message: string }).message).toMatch(/confirmation/i);

		const confirmed = await call(mount('Failed to update role', updateProjectMemberRole), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: bob.id },
			url: 'http://test.local/?confirm=true',
			body: { role: 'viewer' }
		});
		expect(confirmed.status).toBe(204);
	});

	it('promoting to owner skips the owner-count check entirely', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await soleOwnerProject();

		const res = await call(mount('Failed to update role', updateProjectMemberRole), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: bob.id },
			body: { role: 'owner' }
		});

		expect(res.status).toBe(204);
	});

	it('removing a non-owner needs no confirmation', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await soleOwnerProject();

		const res = await call(mount('Failed to remove member', removeProjectMember), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: bob.id }
		});

		expect(res.status).toBe(204);
		const after = await tp.config.data.projects.getProjectMember(
			(await actAs(tp, alice.id)).ctx,
			alicesPrivate.id,
			bob.id
		);
		// The removal must actually reach the store — a handler that guards
		// correctly and then forgets to write still returns 204.
		expect(after).toBeFalsy();
	});

	it('is idempotent for a member who was never there', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await soleOwnerProject();

		const res = await call(mount('Failed to remove member', removeProjectMember), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id, userId: 'ghost-user' }
		});

		expect(res.status).toBe(204);
	});
});

describe('project membership access', () => {
	it('rejects a non-manager listing members with 403, not 500', async () => {
		tp = await freshProviders();
		const { bob, alicesPrivate } = await seedAcme(tp);

		const res = await call(mount('Failed to load members', listProjectMembers), {
			locals: await actAs(tp, bob.id),
			params: { id: alicesPrivate.id }
		});

		// The guard throws SvelteKit's `error()`; without the `isHttpError`
		// branch in the binding this is a 500.
		expect(res.status).toBe(403);
	});

	it('refuses to add a user who is not a member of the project’s org', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: alice.id,
			role: 'owner'
		});
		const { carol } = await seedBigClient(tp);

		const res = await call(mount('Failed to add member', addProjectMember), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id },
			body: { userId: carol.id, role: 'viewer' }
		});

		expect(res.status).toBe(400);
	});
});

describe('dependency injection', () => {
	it('reads and writes through the injected deps, not the module globals', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: alice.id,
			role: 'owner'
		});

		const locals = await actAs(tp, alice.id);
		let sawUpdate = false;
		locals.providers = spyOnStore(locals.providers, 'projects', 'updateProject', () => {
			sawUpdate = true;
		});

		const res = await call(mount('Failed to update project', updateProject), {
			locals,
			params: { id: alicesPrivate.id },
			body: { name: 'Renamed' }
		});

		expect(res.status).toBe(204);
		// Fails if the handler reaches for `getProjectProvider()` instead of
		// `req.deps.projects` — the whole point of the mount.
		expect(sawUpdate).toBe(true);
	});
});

describe('DELETE /api/v1/projects/[id]', () => {
	it('deletes a project the caller manages', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: alice.id,
			role: 'owner'
		});

		const res = await call(mount('Failed to delete project', deleteProject), {
			locals: await actAs(tp, alice.id),
			params: { id: alicesPrivate.id }
		});

		expect(res.status).toBe(204);
	});

	it('rejects a viewer with 403', async () => {
		tp = await freshProviders();
		const { bob, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: bob.id,
			role: 'viewer'
		});

		const res = await call(mount('Failed to delete project', deleteProject), {
			locals: await actAs(tp, bob.id),
			params: { id: alicesPrivate.id }
		});

		expect(res.status).toBe(403);
	});
});
