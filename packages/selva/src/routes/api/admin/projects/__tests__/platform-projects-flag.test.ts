/**
 * `ENABLE_PLATFORM_PROJECTS` off hides platform projects from everyone,
 * instance admins included, so every admin route that reaches one answers 404.
 * Existing rows stay and come back when the flag does.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedProject,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { GET as listProjects } from '../+server.js';
import {
	GET as getProject,
	PATCH as patchProject,
	DELETE as deleteProject
} from '../[id]/+server.js';
import { GET as listGrants } from '../[id]/grants/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

async function seedPlatformProject(flagOn: boolean) {
	tp = await freshProviders({ flags: { ENABLE_PLATFORM_PROJECTS: flagOn } });
	const { alice, acme } = await seedAcme(tp);
	await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
	const project = await seedProject(tp, {
		orgId: acme.id,
		name: 'Platform tools',
		slug: 'platform-tools',
		ownerId: alice.id,
		visibility: 'platform'
	});
	return { project, locals: await actAs(tp, alice.id) };
}

describe('admin platform-project routes with ENABLE_PLATFORM_PROJECTS off', () => {
	it('answers 404 on every route that reaches a project', async () => {
		const { project, locals } = await seedPlatformProject(false);
		const params = { id: project.id };

		expect((await call(listProjects, { locals })).status).toBe(404);
		expect((await call(listGrants, { locals, params })).status).toBe(404);
		expect((await call(getProject, { locals, params })).status).toBe(404);
		expect(
			(await call(patchProject, { locals, params, method: 'PATCH', body: { name: 'Renamed' } }))
				.status
		).toBe(404);
		expect((await call(deleteProject, { locals, params, method: 'DELETE' })).status).toBe(404);

		const stored = await tp!.config.data.projects.getProject(SYSTEM_CONTEXT, project.id);
		expect(stored).toMatchObject({ name: 'Platform tools' });
	});

	it('serves the same project once the flag is on', async () => {
		const { project, locals } = await seedPlatformProject(true);

		const res = await call(getProject, { locals, params: { id: project.id } });

		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ id: project.id, visibility: 'platform' });
	});
});
