/**
 * `listVisibleDefinitions` must issue a constant number of store calls,
 * independent of how many orgs and projects exist.
 *
 * The pattern this replaced was `Promise.all` over per-row reads — concurrent,
 * but still one round-trip per org and per project (~130 queries to render one
 * page at 5 orgs / 60 projects). Concurrency hides that in wall-clock and not at
 * all in database load, so the regression this guards against is invisible to a
 * correctness test: counting is the only way to see it come back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { listVisibleDefinitions } from '../visibility.js';
import { depsFromConfig } from '../../api/index.js';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	seedOrg,
	seedOrgMember,
	seedProject,
	seedDefinition,
	seedUser,
	actAs
} from '../../testing/index.js';

let tp: HandlerHarness;

afterEach(async () => {
	vi.restoreAllMocks();
	await tp?.cleanup();
});

/**
 * Count calls to the per-row membership reads. These are the methods the old
 * implementation called once per org / per project; the bulk versions replacing
 * them are counted separately so a partial regression still shows up.
 */
function countStoreCalls(tp: HandlerHarness) {
	const orgs = tp.config.data.orgs;
	const projects = tp.config.data.projects;
	const counts = {
		getOrgMember: 0,
		getProjectMember: 0,
		getOrgMembersFor: 0,
		getProjectMembersFor: 0,
		listProjects: 0
	};

	// Capture the originals before spying so each wrapper delegates to the real
	// implementation rather than re-entering the spy.
	const original = {
		getOrgMember: orgs.getOrgMember.bind(orgs),
		getProjectMember: projects.getProjectMember.bind(projects),
		getOrgMembersFor: orgs.getOrgMembersFor.bind(orgs),
		getProjectMembersFor: projects.getProjectMembersFor.bind(projects),
		listProjects: projects.listProjects.bind(projects)
	};

	vi.spyOn(orgs, 'getOrgMember').mockImplementation((...args) => {
		counts.getOrgMember++;
		return original.getOrgMember(...args);
	});
	vi.spyOn(projects, 'getProjectMember').mockImplementation((...args) => {
		counts.getProjectMember++;
		return original.getProjectMember(...args);
	});
	vi.spyOn(orgs, 'getOrgMembersFor').mockImplementation((...args) => {
		counts.getOrgMembersFor++;
		return original.getOrgMembersFor(...args);
	});
	vi.spyOn(projects, 'getProjectMembersFor').mockImplementation((...args) => {
		counts.getProjectMembersFor++;
		return original.getProjectMembersFor(...args);
	});
	vi.spyOn(projects, 'listProjects').mockImplementation((...args) => {
		counts.listProjects++;
		return original.listProjects(...args);
	});

	return counts;
}

async function seedTenants(tp: HandlerHarness, orgCount: number, projectsPerOrg: number) {
	const user = await seedUser(tp, `counter-${orgCount}x${projectsPerOrg}@test.test`);
	let homeOrgId = '';
	for (let o = 0; o < orgCount; o++) {
		const org = await seedOrg(tp, {
			name: `Org ${o}`,
			slug: `org-${orgCount}-${projectsPerOrg}-${o}`,
			ownerId: user.id
		});
		if (o === 0) homeOrgId = org.id;
		await seedOrgMember(tp, { orgId: org.id, userId: user.id, role: 'member' });
		for (let p = 0; p < projectsPerOrg; p++) {
			const project = await seedProject(tp, {
				orgId: org.id,
				name: `Project ${o}-${p}`,
				slug: `project-${o}-${p}`,
				ownerId: user.id,
				visibility: 'org'
			});
			await seedDefinition(tp, { projectId: project.id, ownerId: user.id });
		}
	}
	return { user, homeOrgId };
}

describe('listVisibleDefinitions query count', () => {
	it('issues no per-org or per-project membership reads', async () => {
		tp = await freshHarness();
		const { user, homeOrgId } = await seedTenants(tp, 4, 5);
		const { ctx } = await actAs(tp, user.id);

		const counts = countStoreCalls(tp);
		await listVisibleDefinitions(
			{ ...ctx, actingOrgId: homeOrgId },
			{ limit: 50 },
			depsFromConfig(tp.config)
		);

		// The two per-row reads must not appear at all — one call each of their
		// bulk counterparts covers every org and project.
		expect(counts.getOrgMember).toBe(0);
		expect(counts.getProjectMember).toBe(0);
		expect(counts.getOrgMembersFor).toBe(1);
		expect(counts.getProjectMembersFor).toBe(1);
	});

	it('membership reads stay constant as orgs and projects grow', async () => {
		tp = await freshHarness();
		const small = await seedTenants(tp, 2, 2);
		const { ctx: smallCtx } = await actAs(tp, small.user.id);

		const smallCounts = countStoreCalls(tp);
		await listVisibleDefinitions(
			{ ...smallCtx, actingOrgId: small.homeOrgId },
			{ limit: 50 },
			depsFromConfig(tp.config)
		);
		const smallMembershipReads = smallCounts.getOrgMembersFor + smallCounts.getProjectMembersFor;
		vi.restoreAllMocks();

		const large = await seedTenants(tp, 6, 8);
		const { ctx: largeCtx } = await actAs(tp, large.user.id);

		const largeCounts = countStoreCalls(tp);
		await listVisibleDefinitions(
			{ ...largeCtx, actingOrgId: large.homeOrgId },
			{ limit: 50 },
			depsFromConfig(tp.config)
		);
		const largeMembershipReads = largeCounts.getOrgMembersFor + largeCounts.getProjectMembersFor;

		expect(largeMembershipReads).toBe(smallMembershipReads);
		expect(largeCounts.getOrgMember).toBe(0);
		expect(largeCounts.getProjectMember).toBe(0);
	});

	it('scans projects once per org — the one call that is linear, and is a list not a row read', async () => {
		tp = await freshHarness();
		const { user, homeOrgId } = await seedTenants(tp, 3, 4);
		const { ctx } = await actAs(tp, user.id);

		const counts = countStoreCalls(tp);
		await listVisibleDefinitions(
			{ ...ctx, actingOrgId: homeOrgId },
			{ limit: 50 },
			depsFromConfig(tp.config)
		);

		// `listProjects` is per-org by interface shape. It is a paged list, not a
		// row lookup, so it stays O(orgs) rather than O(projects) — collapsing it
		// further needs a cross-org project list on IProjectStore.
		const orgsSeeded = await tp.config.data.orgs.listOrgs(
			{ userId: user.id, actingOrgId: homeOrgId, platformPermissions: [], orgPermissions: [] },
			{ limit: 200 }
		);
		expect(counts.listProjects).toBe(orgsSeeded.items.length);
	});
});
