/**
 * On Supabase a session never sees a private project its user is not in. These
 * run the local stack with the project store narrowed the same way, because the
 * flows here exist to reach exactly those projects.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_CONTEXT, type IApiTokenStore, type IProjectStore } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { actAs, callHandler, seedAcme } from '../../testing/index.js';
import { reclaimProject } from '../reclaim.js';
import { removeOrgMember } from '../orgMembers.js';
import { revokeUserApiTokens } from '../apiTokens.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** What RLS does: only the service role sees projects the session isn't in. */
function hideProjectsFromSessions(projects: IProjectStore, hiddenId: string): void {
	const getProject = projects.getProject.bind(projects);
	const listProjects = projects.listProjects.bind(projects);
	vi.spyOn(projects, 'getProject').mockImplementation(async (ctx, id) =>
		id === hiddenId && !ctx.system ? null : getProject(ctx, id)
	);
	vi.spyOn(projects, 'listProjects').mockImplementation(async (ctx, orgId, opts) => {
		const page = await listProjects(ctx, orgId, opts);
		if (ctx.system) return page;
		return { ...page, items: page.items.filter((p) => p.id !== hiddenId) };
	});
}

describe('reclaim of a project RLS hides', () => {
	it('lets an org admin reclaim it', async () => {
		tp = await freshHarness();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'admin');
		await tp.config.data.projects.removeProjectMember(SYSTEM_CONTEXT, alicesPrivate.id, alice.id);
		hideProjectsFromSessions(tp.config.data.projects, alicesPrivate.id);

		const res = await callHandler(reclaimProject, {
			locals: await actAs(tp, bob.id),
			params: { id: alicesPrivate.id }
		});

		expect(res.status).toBe(201);
	});

	it('answers 404, not 403, to a plain member who cannot see it', async () => {
		tp = await freshHarness();
		const { bob, alicesPrivate } = await seedAcme(tp);
		hideProjectsFromSessions(tp.config.data.projects, alicesPrivate.id);

		const res = await callHandler(reclaimProject, {
			locals: await actAs(tp, bob.id),
			params: { id: alicesPrivate.id }
		});

		expect(res.status).toBe(404);
	});
});

describe('removing a sole owner of a project RLS hides', () => {
	it('still reports the orphaned project', async () => {
		tp = await freshHarness();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'owner');
		hideProjectsFromSessions(tp.config.data.projects, alicesPrivate.id);

		const res = await callHandler(removeOrgMember, {
			locals: await actAs(tp, bob.id),
			method: 'DELETE',
			params: { orgId: acme.id, userId: alice.id }
		});

		expect(res.status).toBe(204);
		const event = tp.events.find((e) => e.type === 'org_member.removed_orphaning_projects');
		expect(event).toMatchObject({ projectIds: expect.arrayContaining([alicesPrivate.id]) });
	});
});

describe('revokeUserApiTokens', () => {
	it('uses the service role, so RLS cannot silently filter it, and keeps the actor', async () => {
		const revokeAllForUser = vi.fn(async () => []);
		const store = { revokeAllForUser } as unknown as IApiTokenStore;
		const ctx = { userId: 'operator', platformPermissions: [], orgPermissions: [] };
		const log = { error: vi.fn() } as never;

		await revokeUserApiTokens(store, ctx, 'target', { reason: 'user_disabled' }, log);

		const [passed] = revokeAllForUser.mock.calls[0] as unknown as [typeof ctx & { system?: true }];
		expect(passed.system).toBe(true);
		expect(passed.userId).toBe('operator');
	});
});
