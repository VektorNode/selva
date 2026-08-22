/**
 * `platform` visibility takes a project out of its org: no org member can see
 * it, `canReclaim` returns false forever, and `canManage` narrows to
 * `instance_admin`. With ENABLE_PLATFORM_PROJECTS off — the default — every
 * rule denies everyone including admins, so the project is unreachable and
 * undeletable.
 *
 * docs/contributing/permissions.md §4a: only `instance_admin` may create a platform project. The
 * UI hid the option; the API accepted it on both POST and PATCH.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	seedAcme,
	seedProject,
	seedProjectMember,
	grantPlatformPermissions,
	actAs,
	callHandler
} from '../../testing/index.js';
import { createProject, updateProject } from '../projects.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('platform visibility is instance-admin only', () => {
	it('refuses POST with visibility=platform from an org admin', async () => {
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await callHandler(createProject, {
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
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Mine',
			slug: 'mine',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await callHandler(updateProject, {
			locals,
			params: { id: project.id },
			body: { visibility: 'platform' }
		});

		expect(res.status).toBe(403);

		const after = await tp.config.data.projects.getProject(SYSTEM_CONTEXT, project.id);
		expect(after?.visibility).toBe('private');
	});

	it('allows an instance admin to set platform visibility', async () => {
		tp = await freshHarness();
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

		const res = await callHandler(updateProject, {
			locals,
			params: { id: project.id },
			body: { visibility: 'platform' }
		});

		expect(res.status).toBe(204);
	});

	it('still allows ordinary visibility changes by the owner', async () => {
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Mine',
			slug: 'mine',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await callHandler(updateProject, {
			locals,
			params: { id: project.id },
			body: { visibility: 'org' }
		});

		expect(res.status).toBe(204);
	});
});
