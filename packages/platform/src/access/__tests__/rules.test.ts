import { describe, expect, it } from 'vitest';
import type { OrgMember } from '../../organizations/types.js';
import type { DefinitionRecord } from '../../definitions/types.js';
import type { Project, ProjectMember } from '../../projects/types.js';
import {
	canCreateDefinition,
	canEdit,
	canEditDefinition,
	canEditProjectSettings,
	canManage,
	canView,
	type ProjectAccessInput
} from '../rules.js';

const project = (over: Partial<Project> = {}): Project =>
	({ id: 'p', orgId: 'acme', visibility: 'public', autoJoinOnUpload: false, ...over }) as Project;
const orgMember = { orgId: 'acme', userId: 'u', role: 'member' } as OrgMember;
const owner = { projectId: 'p', userId: 'u', role: 'owner' } as ProjectMember;

const input = (over: Partial<ProjectAccessInput> = {}): ProjectAccessInput => ({
	orgPermissions: [],
	platformPermissions: [],
	project: project(),
	member: null,
	orgMember: null,
	allowCrossOrgPublic: false,
	enablePlatformProjects: false,
	platformGrants: [],
	actingOrgId: null,
	userId: 'u',
	...over
});

describe('canCreateDefinition on a commons project', () => {
	const commons = (visibility: Project['visibility']) =>
		project({ autoJoinOnUpload: true, visibility });

	it('refuses an outsider with cross-org public off', () => {
		expect(canCreateDefinition(input({ project: commons('public') }))).toBe(false);
	});

	it('takes an outsider with cross-org public on', () => {
		const allowed = input({ project: commons('public'), allowCrossOrgPublic: true });
		expect(canCreateDefinition(allowed)).toBe(true);
	});

	it('takes an org member with cross-org public off', () => {
		expect(canCreateDefinition(input({ project: commons('public'), orgMember }))).toBe(true);
	});

	it('refuses an org member on a private commons they are not in', () => {
		expect(canCreateDefinition(input({ project: commons('private'), orgMember }))).toBe(false);
	});

	it('needs canEdit on a project that is not a commons', () => {
		expect(canCreateDefinition(input({ orgMember }))).toBe(false);
		expect(canCreateDefinition(input({ member: owner }))).toBe(true);
	});
});

describe('canView for a project member outside the org', () => {
	it.each(['org', 'public'] as const)('shows a %s project to its member', (visibility) => {
		expect(canView(input({ project: project({ visibility }), member: owner }))).toBe(true);
	});

	it('still hides an org project from someone in neither', () => {
		expect(canView(input({ project: project({ visibility: 'org' }) }))).toBe(false);
	});
});

describe('rules with no project', () => {
	it.each([
		['canEdit', canEdit],
		['canManage', canManage],
		['canEditProjectSettings', canEditProjectSettings]
	])('%s refuses a stale owner row', (_name, rule) => {
		expect(rule(input({ project: null, member: owner }))).toBe(false);
	});
});

describe('canEditDefinition', () => {
	const base = {
		project: project(),
		member: owner,
		orgMember,
		userId: 'u',
		platformPermissions: [],
		enablePlatformProjects: false
	};

	it('refuses a definition from another project', () => {
		const definition = { projectId: 'other', ownerId: 'u' } as DefinitionRecord;
		expect(canEditDefinition({ ...base, definition })).toBe(false);
	});

	it('allows the project the definition belongs to', () => {
		const definition = { projectId: 'p', ownerId: 'u' } as DefinitionRecord;
		expect(canEditDefinition({ ...base, definition })).toBe(true);
	});
});

describe('canView acting org', () => {
	const orgProject = project({ visibility: 'org' });

	it('needs the caller to be acting as the project org', () => {
		expect(canView(input({ project: orgProject, orgMember, actingOrgId: 'other' }))).toBe(false);
		expect(canView(input({ project: orgProject, orgMember, actingOrgId: 'acme' }))).toBe(true);
	});
});
