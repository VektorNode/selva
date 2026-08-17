/**
 * `platform` visibility takes a project out of its org: no org member can see
 * it, `canReclaim` returns false forever, and `canManage` narrows to
 * `instance_admin`. With ENABLE_PLATFORM_PROJECTS off — the default — every
 * rule denies everyone including admins, so the project is unreachable and
 * undeletable.
 *
 * Permissions.md §4a: only `instance_admin` may create a platform project. The
 * UI hid the option; the API accepted it on both POST and PATCH.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedProject,
	seedProjectMember,
	grantPlatformPermissions,
	actAs,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { POST } from '../+server.js';
import { PATCH } from '../[id]/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('platform visibility is instance-admin only', () => {
	it('refuses POST with visibility=platform from an org admin', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			params: {},
			body: { name: 'Sneaky', visibility: 'platform' }
		});

		expect(res.status).toBe(403);

		const projects = await tp.config.data.projects.listProjects(SYSTEM_CONTEXT, acme.id, {
			limit: 100
		});
		expect(projects.items.some((p) => p.name === 'Sneaky')).toBe(false);
	});

	it('refuses PATCH to visibility=platform by the project owner', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Mine',
			slug: 'mine',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id },
			body: { visibility: 'platform' }
		});

		expect(res.status).toBe(403);

		const after = await tp.config.data.projects.getProject(SYSTEM_CONTEXT, project.id);
		expect(after?.visibility).toBe('private');
	});

	it('allows an instance admin to set platform visibility', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Mine',
			slug: 'mine',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id },
			body: { visibility: 'platform' }
		});

		expect(res.status).toBe(204);
	});

	it('still allows ordinary visibility changes by the owner', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Mine',
			slug: 'mine',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id },
			body: { visibility: 'org' }
		});

		expect(res.status).toBe(204);
	});
});
