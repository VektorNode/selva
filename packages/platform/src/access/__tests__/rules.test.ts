import { describe, it, expect } from 'vitest';
import type { DefinitionRecord } from '../../definitions/types.js';
import type { OrgMember } from '../../organizations/types.js';
import type { PlatformProjectGrant } from '../../platformProjects/types.js';
import type { Project, ProjectMember } from '../../projects/types.js';
import {
	canChangeOrgRole,
	canChangeVisibilityToPublic,
	canCreateDefinition,
	canCreateProject,
	canEdit,
	canEditDefinition,
	canEditProjectSettings,
	canManage,
	canReclaim,
	canSolve,
	canView,
	checkOwnerRemoval,
	withAdminBypass,
	type DefinitionAccessInput,
	type ProjectAccessInput
} from '../rules.js';

// ============================================================================
// helpers
// ============================================================================
const NOW = '2026-01-01T00:00:00.000Z';

function project(overrides: Partial<Project> = {}): Project {
	return {
		id: 'p-1',
		orgId: 'o-1',
		name: 'P',
		slug: 'p',
		visibility: 'private',
		ownerId: 'u-1',
		createdBy: 'u-1',
		updatedBy: 'u-1',
		autoJoinOnUpload: false,
		createdAt: NOW,
		updatedAt: NOW,
		deletedAt: null,
		...overrides
	};
}

function member(role: ProjectMember['role'], userId = 'u-2'): ProjectMember {
	return {
		projectId: 'p-1',
		userId,
		role,
		joinedAt: NOW,
		updatedAt: NOW,
		updatedBy: userId,
		deletedAt: null
	};
}

function orgMember(role: OrgMember['role'], userId = 'u-2'): OrgMember {
	return {
		orgId: 'o-1',
		userId,
		role,
		permissions: [],
		joinedAt: NOW,
		updatedAt: NOW,
		updatedBy: userId,
		deletedAt: null
	};
}

function grant(overrides: Partial<PlatformProjectGrant>): PlatformProjectGrant {
	return {
		id: 'g-1',
		projectId: 'p-1',
		granteeType: 'user',
		granteeId: 'u-grantee',
		canSolve: false,
		createdBy: 'u-admin',
		createdAt: NOW,
		...overrides
	};
}

function accessInput(
	overrides: Partial<ProjectAccessInput> & Pick<ProjectAccessInput, 'project'>
): ProjectAccessInput {
	return {
		platformPermissions: [],
		member: null,
		orgMember: null,
		allowCrossOrgPublic: false,
		enablePlatformProjects: true,
		platformGrants: [],
		actingOrgId: 'o-1',
		userId: 'u-2',
		...overrides
	};
}

function def(overrides: Partial<DefinitionRecord> = {}): DefinitionRecord {
	return {
		guid: 'd-1',
		projectId: 'p-1',
		ownerId: 'u-alice',
		createdBy: 'u-alice',
		updatedBy: 'u-alice',
		displayName: 'D',
		status: 'published',
		solveCount: 0,
		nextVersionNumber: 2,
		liveVersionId: null,
		draftVersionId: null,
		createdAt: NOW,
		updatedAt: NOW,
		deletedAt: null,
		...overrides
	};
}

/**
 * `orgMember` defaults to a present member: it gates only the commons branch,
 * and "still belongs to the org" is the ordinary case. Departure is what a test
 * states explicitly, by passing `orgMember: null`.
 */
function defAccessInput(
	overrides: Partial<DefinitionAccessInput> &
		Pick<DefinitionAccessInput, 'project' | 'definition' | 'userId'>
): DefinitionAccessInput {
	return {
		member: null,
		orgMember: orgMember('member'),
		platformPermissions: [],
		enablePlatformProjects: true,
		...overrides
	};
}

const PROJECT_RULES = [
	['canView', canView],
	['canSolve', canSolve],
	['canEdit', canEdit],
	['canCreateDefinition', canCreateDefinition],
	['canManage', canManage],
	['canEditProjectSettings', canEditProjectSettings]
] as const;

describe('every project rule', () => {
	it.each(PROJECT_RULES)('%s refuses a missing project, even with a stale owner row', (_, rule) => {
		const input = accessInput({
			project: null,
			member: member('owner'),
			allowCrossOrgPublic: true
		});
		expect(rule(input)).toBe(false);
	});
});

// A rule that checked `instance_admin` before the flag would pass every other case here.
describe('platform projects with the feature off', () => {
	const off = {
		project: project({ visibility: 'platform' }),
		enablePlatformProjects: false,
		platformPermissions: ['instance_admin'] as const
	};

	it.each(PROJECT_RULES)('%s refuses an instance admin', (_, rule) => {
		expect(rule(accessInput(off))).toBe(false);
	});

	it('canEditDefinition refuses an instance admin', () => {
		expect(
			canEditDefinition(defAccessInput({ ...off, definition: def(), userId: 'u-admin' }))
		).toBe(false);
	});

	it('canSolve refuses a solve grant', () => {
		const input = accessInput({
			project: project({ visibility: 'platform' }),
			enablePlatformProjects: false,
			userId: 'u-grantee',
			platformGrants: [grant({ canSolve: true })]
		});
		expect(canSolve(input)).toBe(false);
	});
});

// ============================================================================
// canView
// ============================================================================
describe('canView', () => {
	it('private: returns false without a project member', () => {
		const input = accessInput({ project: project(), allowCrossOrgPublic: true });
		expect(canView(input)).toBe(false);
	});

	it('private: viewer role is sufficient', () => {
		const input = accessInput({
			project: project(),
			member: member('viewer'),
			allowCrossOrgPublic: true
		});
		expect(canView(input)).toBe(true);
	});

	it('org: org member passes, non-member fails', () => {
		const org = project({ visibility: 'org' });
		expect(canView(accessInput({ project: org, orgMember: orgMember('member') }))).toBe(true);
		expect(canView(accessInput({ project: org, allowCrossOrgPublic: true }))).toBe(false);
	});

	it('org: needs the caller to be acting as the project org', () => {
		const org = project({ visibility: 'org' });
		const input = accessInput({ project: org, orgMember: orgMember('member'), actingOrgId: 'o-2' });
		expect(canView(input)).toBe(false);
	});

	it('public + cross-org flag on: any authenticated user passes', () => {
		const input = accessInput({
			project: project({ visibility: 'public' }),
			allowCrossOrgPublic: true
		});
		expect(canView(input)).toBe(true);
	});

	it('public + cross-org flag off: requires org membership', () => {
		const pub = project({ visibility: 'public' });
		expect(canView(accessInput({ project: pub, orgMember: orgMember('member') }))).toBe(true);
		expect(canView(accessInput({ project: pub }))).toBe(false);
	});

	it.each(['org', 'public'] as const)(
		'shows a %s project to its member outside the org',
		(visibility) => {
			const input = accessInput({ project: project({ visibility }), member: member('owner') });
			expect(canView(input)).toBe(true);
		}
	);

	// Private means private from org leadership too; reclaim is the escalation path.
	it.each(['owner', 'admin', 'member'] as const)(
		'private: an org %s with no project membership is denied',
		(role) => {
			expect(canView(accessInput({ project: project(), orgMember: orgMember(role) }))).toBe(false);
		}
	);

	it('private: an instance admin with no project membership is denied', () => {
		const input = accessInput({ project: project(), platformPermissions: ['instance_admin'] });
		expect(canView(input)).toBe(false);
	});

	it('platform: instance_admin passes', () => {
		const input = accessInput({
			project: project({ visibility: 'platform' }),
			platformPermissions: ['instance_admin']
		});
		expect(canView(input)).toBe(true);
	});

	it('platform: a view-only user grant passes', () => {
		const input = accessInput({
			project: project({ visibility: 'platform' }),
			userId: 'u-grantee',
			platformGrants: [grant({ canSolve: false })]
		});
		expect(canView(input)).toBe(true);
	});

	it('platform: an org grant passes for the acting org only', () => {
		const platformGrants = [grant({ granteeType: 'org', granteeId: 'o-grantee' })];
		const platform = project({ visibility: 'platform' });
		expect(
			canView(accessInput({ project: platform, actingOrgId: 'o-grantee', platformGrants }))
		).toBe(true);
		expect(canView(accessInput({ project: platform, actingOrgId: 'o-1', platformGrants }))).toBe(
			false
		);
	});

	it('platform: no grant, no admin → denied', () => {
		expect(canView(accessInput({ project: project({ visibility: 'platform' }) }))).toBe(false);
	});
});

// ============================================================================
// canSolve
// ============================================================================
describe('canSolve', () => {
	it('matches canView for non-platform visibility', () => {
		for (const v of ['public', 'org', 'private'] as const) {
			const input = accessInput({
				project: project({ visibility: v }),
				member: v === 'private' ? member('viewer') : null,
				orgMember: v === 'org' ? orgMember('member') : null,
				allowCrossOrgPublic: true
			});
			expect(canSolve(input)).toBe(canView(input));
		}
	});

	it('platform: instance_admin passes', () => {
		const input = accessInput({
			project: project({ visibility: 'platform' }),
			platformPermissions: ['instance_admin']
		});
		expect(canSolve(input)).toBe(true);
	});

	it('platform: a grant needs canSolve', () => {
		const platform = project({ visibility: 'platform' });
		const withGrant = (canSolveGrant: boolean) =>
			accessInput({
				project: platform,
				userId: 'u-grantee',
				platformGrants: [grant({ canSolve: canSolveGrant })]
			});
		expect(canSolve(withGrant(true))).toBe(true);
		expect(canSolve(withGrant(false))).toBe(false);
	});
});

// ============================================================================
// canEdit / canManage / canEditProjectSettings
// ============================================================================
describe('canEdit', () => {
	it('project owner/editor yes; viewer no', () => {
		const base = accessInput({ project: project(), allowCrossOrgPublic: true });
		expect(canEdit({ ...base, member: member('owner') })).toBe(true);
		expect(canEdit({ ...base, member: member('editor') })).toBe(true);
		expect(canEdit({ ...base, member: member('viewer') })).toBe(false);
		expect(canEdit({ ...base, member: null })).toBe(false);
	});

	it('manage_definitions org-perm does not grant edit', () => {
		const input = accessInput({
			orgPermissions: ['manage_definitions'],
			project: project({ visibility: 'public' }),
			orgMember: orgMember('member'),
			allowCrossOrgPublic: true
		});
		expect(canEdit(input)).toBe(false);
	});

	it('platform project: instance_admin passes; project member role is ignored', () => {
		const platform = project({ visibility: 'platform' });
		const admin = accessInput({ project: platform, platformPermissions: ['instance_admin'] });
		expect(canEdit(admin)).toBe(true);
		expect(canEdit(accessInput({ project: platform, member: member('owner') }))).toBe(false);
	});
});

describe('canEditProjectSettings', () => {
	it('project owner yes; editor no, whatever their org permissions', () => {
		const base = accessInput({ project: project(), allowCrossOrgPublic: true });
		expect(canEditProjectSettings({ ...base, member: member('owner') })).toBe(true);
		const editor = {
			...base,
			orgPermissions: ['manage_definitions', 'manage_projects'] as const,
			member: member('editor')
		};
		expect(canEditProjectSettings(editor)).toBe(false);
	});
});

describe('canManage', () => {
	it('only project owner passes', () => {
		const base = accessInput({ project: project(), allowCrossOrgPublic: true });
		expect(canManage({ ...base, member: member('owner') })).toBe(true);
		expect(canManage({ ...base, member: member('editor') })).toBe(false);
		expect(canManage({ ...base, member: null })).toBe(false);
	});

	it('platform project: instance_admin passes; non-admin denied', () => {
		const platform = project({ visibility: 'platform' });
		const admin = accessInput({ project: platform, platformPermissions: ['instance_admin'] });
		expect(canManage(admin)).toBe(true);
		expect(canManage(accessInput({ project: platform, member: member('owner') }))).toBe(false);
	});
});

// ============================================================================
// canCreateDefinition
// ============================================================================
describe('canCreateDefinition on a commons project', () => {
	const commons = (visibility: Project['visibility']) =>
		project({ autoJoinOnUpload: true, visibility });

	it('refuses an outsider with cross-org public off', () => {
		expect(canCreateDefinition(accessInput({ project: commons('public') }))).toBe(false);
	});

	it('takes an outsider with cross-org public on', () => {
		const input = accessInput({ project: commons('public'), allowCrossOrgPublic: true });
		expect(canCreateDefinition(input)).toBe(true);
	});

	it('takes an org member with cross-org public off', () => {
		const input = accessInput({ project: commons('public'), orgMember: orgMember('member') });
		expect(canCreateDefinition(input)).toBe(true);
	});

	it('refuses an org member on a private commons they are not in', () => {
		const input = accessInput({ project: commons('private'), orgMember: orgMember('member') });
		expect(canCreateDefinition(input)).toBe(false);
	});

	it('needs canEdit on a project that is not a commons', () => {
		const pub = project({ visibility: 'public' });
		expect(canCreateDefinition(accessInput({ project: pub, orgMember: orgMember('member') }))).toBe(
			false
		);
		expect(canCreateDefinition(accessInput({ project: pub, member: member('owner') }))).toBe(true);
	});
});

// ============================================================================
// canEditDefinition
// ============================================================================
describe('canEditDefinition', () => {
	it('refuses a definition from another project, even to its editor', () => {
		const input = defAccessInput({
			project: project(),
			definition: def({ projectId: 'p-other' }),
			member: member('editor'),
			userId: 'u-2'
		});
		expect(canEditDefinition(input)).toBe(false);
	});

	it('container project: only project editors/owners', () => {
		const p = project({ visibility: 'public' });
		const editor = defAccessInput({
			project: p,
			definition: def(),
			member: member('editor', 'u-editor'),
			userId: 'u-editor'
		});
		expect(canEditDefinition(editor)).toBe(true);
		expect(
			canEditDefinition(defAccessInput({ project: p, definition: def(), userId: 'u-alice' }))
		).toBe(false);
	});

	it('container project: org membership is not consulted', () => {
		// In container mode project role is the whole rule, so an org member with
		// no project role stays out and a project editor outside the org stays in.
		const p = project({ visibility: 'org' });
		expect(
			canEditDefinition(defAccessInput({ project: p, definition: def(), userId: 'u-alice' }))
		).toBe(false);
		const editor = defAccessInput({
			project: p,
			definition: def(),
			member: member('editor', 'u-alice'),
			orgMember: null,
			userId: 'u-alice'
		});
		expect(canEditDefinition(editor)).toBe(true);
	});

	it('commons project: the definition owner edits their own, nobody else’s', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition(defAccessInput({ project: p, definition: def(), userId: 'u-alice' }))
		).toBe(true);
		expect(
			canEditDefinition(defAccessInput({ project: p, definition: def(), userId: 'u-peter' }))
		).toBe(false);
	});

	it('commons project: a definition owner who left the org loses edit', () => {
		// `ownerId` records who uploaded, not who still belongs. Without this check,
		// flipping `autoJoinOnUpload` on hands a departed contractor edit, delete and
		// share-link authority over everything they ever uploaded.
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		const departed = defAccessInput({
			project: p,
			definition: def(),
			orgMember: null,
			userId: 'u-alice'
		});
		expect(canEditDefinition(departed)).toBe(false);
	});

	it('commons project: a project editor still moderates any definition', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		const moderator = defAccessInput({
			project: p,
			definition: def(),
			member: member('editor', 'u-mod'),
			userId: 'u-mod'
		});
		expect(canEditDefinition(moderator)).toBe(true);
	});

	it('platform project: instance_admin only, not a grant holder', () => {
		const p = project({ visibility: 'platform' });
		const admin = defAccessInput({
			project: p,
			definition: def(),
			userId: 'u-admin',
			platformPermissions: ['instance_admin']
		});
		expect(canEditDefinition(admin)).toBe(true);
		expect(
			canEditDefinition(defAccessInput({ project: p, definition: def(), userId: 'u-grantee' }))
		).toBe(false);
	});
});

// ============================================================================
// org governance
// ============================================================================
describe('canChangeVisibilityToPublic', () => {
	it('org owner/admin can flip, a member cannot', () => {
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('owner') })).toBe(true);
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('admin') })).toBe(true);
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('member') })).toBe(false);
	});
});

describe('canReclaim', () => {
	it.each(['owner', 'admin'] as const)(
		'lets an org %s acting in the project org reclaim',
		(role) => {
			const input = { project: project(), orgMember: orgMember(role), actingOrgId: 'o-1' };
			expect(canReclaim(input)).toBe(true);
		}
	);

	it('refuses an org owner acting in another org', () => {
		const input = { project: project(), orgMember: orgMember('owner'), actingOrgId: 'o-2' };
		expect(canReclaim(input)).toBe(false);
	});

	it('refuses a plain member and a platform project', () => {
		expect(
			canReclaim({ project: project(), orgMember: orgMember('member'), actingOrgId: 'o-1' })
		).toBe(false);
		const platform = project({ visibility: 'platform' });
		expect(
			canReclaim({ project: platform, orgMember: orgMember('owner'), actingOrgId: 'o-1' })
		).toBe(false);
	});
});

describe('canCreateProject', () => {
	const input = (role: OrgMember['role'] | null, over: { actingOrgId?: string } = {}) => ({
		orgPermissions: [] as const,
		orgMember: role ? orgMember(role) : null,
		actingOrgId: 'o-1',
		targetOrgId: 'o-1',
		...over
	});

	it.each(['owner', 'admin'] as const)('lets an org %s create', (role) => {
		expect(canCreateProject(input(role))).toBe(true);
	});

	it('lets a member create only with manage_projects', () => {
		expect(canCreateProject(input('member'))).toBe(false);
		expect(canCreateProject({ ...input('member'), orgPermissions: ['manage_projects'] })).toBe(
			true
		);
	});

	it('refuses an owner acting in another org, and a non-member', () => {
		expect(canCreateProject(input('owner', { actingOrgId: 'o-2' }))).toBe(false);
		expect(canCreateProject({ ...input(null), orgPermissions: ['manage_projects'] })).toBe(false);
	});
});

describe('canChangeOrgRole', () => {
	it('only an owner may grant or revoke owner/admin standing', () => {
		for (const role of ['owner', 'admin'] as const) {
			expect(canChangeOrgRole({ actorMember: orgMember('owner'), role })).toBe(true);
			expect(canChangeOrgRole({ actorMember: orgMember('admin'), role })).toBe(false);
			expect(canChangeOrgRole({ actorMember: orgMember('member'), role })).toBe(false);
			expect(canChangeOrgRole({ actorMember: null, role })).toBe(false);
		}
	});

	it('admins may still act on plain members', () => {
		// The gate narrows to owner/admin targets. Ordinary member management is
		// what `manage_org_members` is for, and this rule must not swallow it.
		expect(canChangeOrgRole({ actorMember: orgMember('admin'), role: 'member' })).toBe(true);
		expect(canChangeOrgRole({ actorMember: orgMember('member'), role: 'member' })).toBe(true);
	});
});

// ============================================================================
// checkOwnerRemoval
// ============================================================================
describe('checkOwnerRemoval', () => {
	it.each(['editor', 'viewer'] as const)(
		'returns ok for a %s target without confirmation',
		(role) => {
			const result = checkOwnerRemoval({
				target: { role },
				allMembers: [{ role: 'owner' }],
				confirmed: false
			});
			expect(result).toBe('ok');
		}
	);

	it('blocks sole-owner removal even with confirmation', () => {
		const result = checkOwnerRemoval({
			target: { role: 'owner' },
			allMembers: [{ role: 'owner' }, { role: 'editor' }],
			confirmed: true
		});
		expect(result).toBe('sole_owner');
	});

	it('needs confirmation to remove one of two owners', () => {
		const removal = (confirmed: boolean) =>
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'owner' }, { role: 'owner' }],
				confirmed
			});
		expect(removal(false)).toBe('needs_confirm');
		expect(removal(true)).toBe('ok');
	});

	it('reports sole_owner when the member list holds no owner at all', () => {
		// A corrupt or incomplete member list must not let the last owner go.
		const result = checkOwnerRemoval({
			target: { role: 'owner' },
			allMembers: [{ role: 'editor' }],
			confirmed: true
		});
		expect(result).toBe('sole_owner');
	});
});

describe('withAdminBypass', () => {
	it('short-circuits for instance_admin without calling the rule', () => {
		let invoked = false;
		const result = withAdminBypass(['instance_admin'], () => {
			invoked = true;
			return false;
		});
		expect(result).toBe(true);
		expect(invoked).toBe(false);
	});

	it('returns the rule for anyone else', () => {
		expect(withAdminBypass([], () => false)).toBe(false);
	});
});
