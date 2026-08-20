/**
 * Finding 12 — a public project exposed its member roster to everyone who
 * could see the project.
 *
 * The Supabase `project_members` SELECT policy was `visible_project(project_id)`,
 * so on a public project any authenticated user could enumerate membership. The
 * fix is a narrower policy, but RLS alone would only make Supabase stricter than
 * local — so the decision is made here, where the audience is known, and both
 * providers agree because neither store is deciding. This suite runs against the
 * local provider, which has no RLS at all; a green run means the route is what
 * enforces it.
 *
 * The tests act as Bob (plain member + `manage_projects`) for the same reason
 * finding 11's do: §11 says an admin may hand that permission to a plain member,
 * and it gates the branch that loads rosters. Alice would pass either way — she
 * owns every project in the fixture.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedOrgMember,
	seedProjectMember,
	actAs,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { load, type ProjectWithMembers } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

type LoadResult = { projects: ProjectWithMembers[] };

async function runLoad(locals: unknown): Promise<LoadResult> {
	return (await load({ locals } as Parameters<typeof load>[0])) as LoadResult;
}

async function bobWithManageProjects(fixture: Awaited<ReturnType<typeof seedAcme>>) {
	await seedOrgMember(tp!, {
		orgId: fixture.acme.id,
		userId: fixture.bob.id,
		role: 'member',
		permissions: ['manage_projects']
	});
	return actAs(tp!, fixture.bob.id);
}

describe('/projects roster visibility', () => {
	it('withholds the roster of a public project the caller does not manage', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		// Bob can view the public project — that is not in question, and the row
		// is still here. What he must not get is the list of who is in it.
		const row = projects.find((p) => p.id === fixture.acmePublic.id);
		expect(row).toBeDefined();
		expect(row?.members).toEqual([]);
	});

	it('withholds the roster of an org project the caller does not manage', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		const row = projects.find((p) => p.id === fixture.acmeOrg.id);
		expect(row).toBeDefined();
		expect(row?.members).toEqual([]);
	});

	it('gives the roster to a project owner', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		// The control: `canManage` is the gate, so the person it passes for must
		// still get the roster, or the fix is just a blanket deny.
		const locals = await actAs(tp, fixture.alice.id);
		const { projects } = await runLoad(locals);

		const row = projects.find((p) => p.id === fixture.acmePublic.id);
		expect(row?.members.map((m) => m.userId)).toContain(fixture.alice.id);
	});

	it('gives the roster once the caller is made a project owner', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: fixture.acmePublic.id,
			userId: fixture.bob.id,
			role: 'owner'
		});

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		const row = projects.find((p) => p.id === fixture.acmePublic.id);
		expect(row?.members.map((m) => m.userId)).toEqual(
			expect.arrayContaining([fixture.alice.id, fixture.bob.id])
		);
	});

	it('reports canManage per project, not from the org-wide permission', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: fixture.acmeOrg.id,
			userId: fixture.bob.id,
			role: 'owner'
		});

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		// `manage_projects` decides whether the settings surface exists; this
		// decides which rows it may act on. Before, the button was offered on
		// every row and the PATCH behind it rejected owner-only — a dead end.
		expect(projects.find((p) => p.id === fixture.acmeOrg.id)?.canManage).toBe(true);
		expect(projects.find((p) => p.id === fixture.acmePublic.id)?.canManage).toBe(false);
	});

	it('withholds the roster from a project editor', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: fixture.acmePublic.id,
			userId: fixture.bob.id,
			role: 'editor'
		});

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		// `canManage` collapses to owner-only (§5) — an editor edits content, and
		// membership is not content. This is what separates the gate from `canEdit`.
		const row = projects.find((p) => p.id === fixture.acmePublic.id);
		expect(row?.members).toEqual([]);
	});
});
