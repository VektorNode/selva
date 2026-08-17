/**
 * Finding 20 — removing an org member silently strips projects of their sole
 * owner. `removeOrgMember` cascades every `project_members` row, so a project
 * whose only owner was the departing member is left with nobody who can manage
 * it: no settings, no roster, no delete.
 *
 * Decided (2026-08-17): **report, do not block.** §10's "blocked until a new
 * owner is assigned" is retired. Blocking scales the cost of offboarding with
 * how many projects the leaver owned, which is backwards — and an offboarding
 * that stalls halfway leaves the person in the org meanwhile. Reclaim already
 * recovers an ownerless project; what was missing was any signal that it needed
 * to happen.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { DomainEvent } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedUser,
	seedOrgMember,
	seedProject,
	seedProjectMember,
	actAs,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { DELETE } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

function orphanEvents(events: TestProviders['events']) {
	return events.filter(
		(e): e is Extract<DomainEvent, { type: 'org_member.removed_orphaning_projects' }> =>
			e.type === 'org_member.removed_orphaning_projects'
	);
}

/** An org owner, since removing an owner is itself owner-only (§3). */
async function seedActingOwner(orgId: string) {
	const user = await seedUser(tp!, 'owner@acme.test');
	await seedOrgMember(tp!, { orgId, userId: user.id, role: 'owner' });
	return user;
}

describe('DELETE org member — projects left without an owner', () => {
	it('removes the member and reports the orphaned project rather than blocking', async () => {
		tp = await freshProviders();
		const { acme, bob } = await seedAcme(tp);
		const actor = await seedActingOwner(acme.id);

		// Bob is the only owner of this project. Removing him from the org
		// cascades that row away and leaves nobody able to manage it.
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: "Bob's Project",
			slug: 'bobs-project',
			ownerId: bob.id,
			visibility: 'private'
		});
		await seedProjectMember(tp, { projectId: project.id, userId: bob.id, role: 'owner' });

		const res = await call(DELETE, {
			locals: await actAs(tp, actor.id),
			params: { orgId: acme.id, userId: bob.id }
		});

		// The decision, in one assertion: the removal succeeds.
		expect(res.status).toBe(204);

		const emitted = orphanEvents(tp.events);
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({ orgId: acme.id, userId: bob.id, actorId: actor.id });
		expect(emitted[0].projectIds).toEqual([project.id]);
	});

	it('stays silent when the project keeps another owner', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const actor = await seedActingOwner(acme.id);

		// Two owners: Bob leaving costs the project nothing, so an event here
		// would be noise — and noise in an audit log is how real signals get
		// ignored.
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Shared Project',
			slug: 'shared-project',
			ownerId: alice.id,
			visibility: 'private'
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		await seedProjectMember(tp, { projectId: project.id, userId: bob.id, role: 'owner' });

		const res = await call(DELETE, {
			locals: await actAs(tp, actor.id),
			params: { orgId: acme.id, userId: bob.id }
		});

		expect(res.status).toBe(204);
		expect(orphanEvents(tp.events)).toHaveLength(0);
	});

	it('does not count a non-owner membership as orphaning', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const actor = await seedActingOwner(acme.id);

		// Bob is an editor. He is the only *member* besides Alice, but the
		// project's owner is untouched by his removal.
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Alice Project',
			slug: 'alice-project-2',
			ownerId: alice.id,
			visibility: 'private'
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		await seedProjectMember(tp, { projectId: project.id, userId: bob.id, role: 'editor' });

		const res = await call(DELETE, {
			locals: await actAs(tp, actor.id),
			params: { orgId: acme.id, userId: bob.id }
		});

		expect(res.status).toBe(204);
		expect(orphanEvents(tp.events)).toHaveLength(0);
	});

	it('reports every orphaned project, not just the first', async () => {
		tp = await freshProviders();
		const { acme, bob } = await seedAcme(tp);
		const actor = await seedActingOwner(acme.id);

		const ids: string[] = [];
		for (const n of [1, 2, 3]) {
			const p = await seedProject(tp, {
				orgId: acme.id,
				name: `Bob Project ${n}`,
				slug: `bob-project-${n}`,
				ownerId: bob.id,
				visibility: 'private'
			});
			await seedProjectMember(tp, { projectId: p.id, userId: bob.id, role: 'owner' });
			ids.push(p.id);
		}

		await call(DELETE, {
			locals: await actAs(tp, actor.id),
			params: { orgId: acme.id, userId: bob.id }
		});

		const emitted = orphanEvents(tp.events);
		expect(emitted).toHaveLength(1);
		// One event listing all of them, rather than one event each — an admin
		// reading the log wants "this offboarding cost three projects", not three
		// rows to correlate.
		expect([...emitted[0].projectIds].sort()).toEqual(ids.sort());
	});

	it('checks before the cascade, not after', async () => {
		tp = await freshProviders();
		const { acme, bob } = await seedAcme(tp);
		const actor = await seedActingOwner(acme.id);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: "Bob's Only",
			slug: 'bobs-only',
			ownerId: bob.id,
			visibility: 'private'
		});
		await seedProjectMember(tp, { projectId: project.id, userId: bob.id, role: 'owner' });

		await call(DELETE, {
			locals: await actAs(tp, actor.id),
			params: { orgId: acme.id, userId: bob.id }
		});

		// `removeOrgMember` soft-deletes the very rows the check reads. Run in the
		// other order it finds no owners at all, decides nothing was orphaned, and
		// reports exactly nothing on the case it exists for.
		expect(orphanEvents(tp.events)[0]?.projectIds).toEqual([project.id]);

		const remaining = await tp.config.data.projects.listProjectMembers(SYSTEM_CONTEXT, project.id, {
			limit: 50
		});
		expect(remaining.items.filter((m) => !m.deletedAt)).toHaveLength(0);
	});
});
