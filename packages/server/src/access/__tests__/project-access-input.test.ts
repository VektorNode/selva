import { describe, it, expect, vi } from 'vitest';
import type {
	Project,
	ProjectAccessInput,
	ProjectVisibility,
	RequestContext
} from '@selvajs/platform';
import {
	createProjectAccessInputBuilder,
	type ProjectAccessFlags
} from '../project-access-input.js';

const CTX: RequestContext = {
	userId: 'user-1',
	actingOrgId: 'org-1',
	platformPermissions: ['manage_compute'],
	orgPermissions: ['manage_org_members']
} as RequestContext;

function project(visibility: ProjectVisibility): Project {
	return {
		id: 'proj-1',
		orgId: 'org-1',
		name: 'P',
		slug: 'p',
		visibility,
		ownerId: 'user-9',
		createdBy: 'user-9',
		updatedBy: 'user-9',
		autoJoinOnUpload: false,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z'
	};
}

// The builder passes rows through opaquely, so only identity matters — these
// three are deliberately not full valid rows.
const MEMBER = {
	projectId: 'proj-1',
	userId: 'user-1',
	role: 'editor'
} as unknown as NonNullable<ProjectAccessInput['member']>;
const ORG_MEMBER = {
	orgId: 'org-1',
	userId: 'user-1',
	role: 'member'
} as unknown as NonNullable<ProjectAccessInput['orgMember']>;
const GRANT = {
	projectId: 'proj-1',
	orgId: 'org-2',
	canSolve: true
} as unknown as ProjectAccessInput['platformGrants'][number];

function makeDeps(flags: Partial<ProjectAccessFlags> = {}) {
	return {
		getProjectMember: vi.fn().mockResolvedValue(MEMBER),
		getOrgMember: vi.fn().mockResolvedValue(ORG_MEMBER),
		listPlatformGrants: vi.fn().mockResolvedValue([GRANT]),
		flags: vi.fn().mockReturnValue({
			allowCrossOrgPublic: false,
			enablePlatformProjects: false,
			...flags
		})
	};
}

describe('buildProjectAccessInput — per-visibility row fetching', () => {
	it('private: fetches only the project member row', async () => {
		const deps = makeDeps();
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project('private'));

		expect(input.member).toEqual(MEMBER);
		expect(input.orgMember).toBeNull();
		expect(input.platformGrants).toEqual([]);
		expect(deps.getOrgMember).not.toHaveBeenCalled();
		expect(deps.listPlatformGrants).not.toHaveBeenCalled();
	});

	it.each(['org', 'public'] as const)('%s: fetches project member + org member', async (vis) => {
		const deps = makeDeps();
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project(vis));

		expect(input.member).toEqual(MEMBER);
		expect(input.orgMember).toEqual(ORG_MEMBER);
		expect(deps.getOrgMember).toHaveBeenCalledWith(CTX, 'org-1', 'user-1');
	});

	it('public + ALLOW_CROSS_ORG_PUBLIC: skips the org member row', async () => {
		const deps = makeDeps({ allowCrossOrgPublic: true });
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project('public'));

		expect(input.member).toEqual(MEMBER);
		expect(input.orgMember).toBeNull();
		expect(deps.getOrgMember).not.toHaveBeenCalled();
	});

	it('org visibility still fetches the org row when cross-org public is on', async () => {
		const deps = makeDeps({ allowCrossOrgPublic: true });
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project('org'));
		expect(input.orgMember).toEqual(ORG_MEMBER);
	});

	it('platform + flag on: fetches grants only', async () => {
		const deps = makeDeps({ enablePlatformProjects: true });
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project('platform'));

		expect(input.platformGrants).toEqual([GRANT]);
		expect(input.member).toBeNull();
		expect(deps.getProjectMember).not.toHaveBeenCalled();
		expect(deps.getOrgMember).not.toHaveBeenCalled();
	});

	it('platform + flag off: skips the grant lookup entirely (feature disabled stays cheap)', async () => {
		const deps = makeDeps({ enablePlatformProjects: false });
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project('platform'));

		expect(input.platformGrants).toEqual([]);
		expect(deps.listPlatformGrants).not.toHaveBeenCalled();
	});

	it('threads ctx fields and flags into the input, with overrides winning', async () => {
		const deps = makeDeps({ allowCrossOrgPublic: true });
		const builder = createProjectAccessInputBuilder(deps);
		const input = await builder.buildProjectAccessInput(CTX, project('private'), {
			member: null
		});

		expect(input.userId).toBe('user-1');
		expect(input.actingOrgId).toBe('org-1');
		expect(input.orgPermissions).toEqual(CTX.orgPermissions);
		expect(input.platformPermissions).toEqual(CTX.platformPermissions);
		expect(input.allowCrossOrgPublic).toBe(true);
		// makeDeps still returns MEMBER — the explicit override is what nulls it.
		expect(input.member).toBeNull();
	});

	it('reads flags per call, not at builder creation', async () => {
		const deps = makeDeps();
		const builder = createProjectAccessInputBuilder(deps);
		await builder.buildProjectAccessInput(CTX, project('private'));
		deps.flags.mockReturnValue({ allowCrossOrgPublic: true, enablePlatformProjects: true });
		const input = await builder.buildProjectAccessInput(CTX, project('private'));
		expect(input.enablePlatformProjects).toBe(true);
	});
});

describe('projectAccessInputFromRows', () => {
	it('assembles from caller rows with zero I/O', () => {
		const deps = makeDeps();
		const builder = createProjectAccessInputBuilder(deps);
		const input = builder.projectAccessInputFromRows(CTX, project('org'), {
			member: MEMBER,
			orgMember: ORG_MEMBER
		});

		expect(input.member).toEqual(MEMBER);
		expect(input.orgMember).toEqual(ORG_MEMBER);
		expect(input.platformGrants).toEqual([]);
		expect(deps.getProjectMember).not.toHaveBeenCalled();
		expect(deps.getOrgMember).not.toHaveBeenCalled();
		expect(deps.listPlatformGrants).not.toHaveBeenCalled();
	});

	it('defaults omitted rows to null/empty', () => {
		const builder = createProjectAccessInputBuilder(makeDeps());
		const input = builder.projectAccessInputFromRows(CTX, project('private'), {});
		expect(input.member).toBeNull();
		expect(input.orgMember).toBeNull();
		expect(input.platformGrants).toEqual([]);
	});
});
