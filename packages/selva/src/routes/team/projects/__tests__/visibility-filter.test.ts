/**
 * Finding 11 — `/team/projects` named every private project in the org.
 *
 * The page gates on `manage_projects`, which §11 explicitly says an admin may
 * hand to a plain org `member`. That permission means "may administer
 * projects", not "may see every project" — but the loader read a raw
 * `listProjects`, which the local provider does not filter by context. So a
 * member holding it saw the exact row §11 says must not appear, with a live
 * Delete button beside it.
 *
 * The tests act as Bob (plain member + `manage_projects`) precisely because
 * Alice would pass either way — she owns the private project.
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
import { load, type ProjectRow } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

// `PageServerLoad` widens its return, so name the shape the page actually gets.
type LoadResult = { projects: ProjectRow[]; canCreate: boolean };

async function runLoad(locals: unknown): Promise<LoadResult> {
	return (await load({ locals } as Parameters<typeof load>[0])) as LoadResult;
}

/** Bob as §11 describes him: role `member`, granted `manage_projects`. */
async function bobWithManageProjects(fixture: Awaited<ReturnType<typeof seedAcme>>) {
	await seedOrgMember(tp!, {
		orgId: fixture.acme.id,
		userId: fixture.bob.id,
		role: 'member',
		permissions: ['manage_projects']
	});
	return actAs(tp!, fixture.bob.id);
}

describe('/team/projects visibility', () => {
	it('hides a private project the caller is not a member of', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		const names = projects.map((p) => p.name);
		expect(names).not.toContain(fixture.alicesPrivate.name);
		// The org and public projects are his to administer — the gate still works.
		expect(names).toEqual(expect.arrayContaining([fixture.acmeOrg.name, fixture.acmePublic.name]));
	});

	it('shows a private project once the caller is a member of it', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: fixture.alicesPrivate.id,
			userId: fixture.bob.id,
			role: 'editor'
		});

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		expect(projects.map((p) => p.name)).toContain(fixture.alicesPrivate.name);
	});

	it('still shows the owner their own private project', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		const locals = await actAs(tp, fixture.alice.id);
		const { projects } = await runLoad(locals);

		expect(projects.map((p) => p.name)).toContain(fixture.alicesPrivate.name);
	});

	it('counts members of a project the caller can view', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: fixture.acmeOrg.id,
			userId: fixture.bob.id,
			role: 'editor'
		});

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		// Alice (owner) + Bob. The count runs as SYSTEM_CONTEXT deliberately —
		// visibility was already decided before the project was nameable.
		const row = projects.find((p) => p.id === fixture.acmeOrg.id);
		expect(row?.memberCount).toBe(2);
	});

	it('refuses a member without manage_projects', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		const locals = await actAs(tp, fixture.bob.id);
		await expect(runLoad(locals)).rejects.toMatchObject({ status: 303 });
	});

	it('does not leak other orgs’ projects into the acting org', async () => {
		tp = await freshProviders();
		const fixture = await seedAcme(tp);

		const locals = await bobWithManageProjects(fixture);
		const { projects } = await runLoad(locals);

		expect(projects.every((p) => p.orgId === fixture.acme.id)).toBe(true);
	});
});
