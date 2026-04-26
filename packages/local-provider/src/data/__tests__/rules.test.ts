/**
 * Pure-rule tests for @selvajs/platform/access — exercised directly with
 * constructed inputs. Lives here because the platform package doesn't run
 * its own vitest.
 */
import { describe, it, expect } from 'vitest';
import {
	canView,
	canSolve,
	canEdit,
	canManage,
	canEditProjectSettings,
	canEditDefinition,
	canChangeVisibilityToPublic,
	checkOwnerRemoval,
	withAdminBypass,
	type DefinitionRecord,
	type OrgMember,
	type Project,
	type ProjectMember
} from '@selvajs/platform';

// ============================================================================
// helpers
// ============================================================================
function project(overrides: Partial<Project> = {}): Project {
	const now = new Date().toISOString();
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
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...overrides
	};
}

function member(role: ProjectMember['role'], userId = 'u-2'): ProjectMember {
	const now = new Date().toISOString();
	return {
		projectId: 'p-1',
		userId,
		role,
		joinedAt: now,
		updatedAt: now,
		updatedBy: userId,
		deletedAt: null
	};
}

function orgMember(role: OrgMember['role'], userId = 'u-2'): OrgMember {
	const now = new Date().toISOString();
	return {
		orgId: 'o-1',
		userId,
		role,
		permissions: [],
		joinedAt: now,
		updatedAt: now,
		updatedBy: userId,
		deletedAt: null
	};
}

function def(overrides: Partial<DefinitionRecord> = {}): DefinitionRecord {
	const now = new Date().toISOString();
	return {
		guid: 'd-1',
		projectId: 'p-1',
		ownerId: 'u-alice',
		createdBy: 'u-alice',
		updatedBy: 'u-alice',
		displayName: 'D',
		status: 'published',
		runCount: 0,
		liveVersionId: null,
		draftVersionId: null,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...overrides
	};
}

// ============================================================================
// canView
// ============================================================================
describe('canView', () => {
	it('private: returns false without a project member', () => {
		expect(
			canView({
				orgPermissions: [],
				project: project({ visibility: 'private' }),
				member: null,
				orgMember: null,
				allowCrossOrgPublic: true
			})
		).toBe(false);
	});

	it('private: viewer role is sufficient', () => {
		expect(
			canView({
				orgPermissions: [],
				project: project({ visibility: 'private' }),
				member: member('viewer'),
				orgMember: null,
				allowCrossOrgPublic: true
			})
		).toBe(true);
	});

	it('org: org member passes, non-member fails', () => {
		const pub = project({ visibility: 'org' });
		expect(
			canView({
				orgPermissions: [],
				project: pub,
				member: null,
				orgMember: orgMember('member'),
				allowCrossOrgPublic: true
			})
		).toBe(true);
		expect(
			canView({
				orgPermissions: [],
				project: pub,
				member: null,
				orgMember: null,
				allowCrossOrgPublic: true
			})
		).toBe(false);
	});

	it('public + cross-org flag on: any authenticated user passes', () => {
		expect(
			canView({
				orgPermissions: [],
				project: project({ visibility: 'public' }),
				member: null,
				orgMember: null,
				allowCrossOrgPublic: true
			})
		).toBe(true);
	});

	it('public + cross-org flag off: requires org membership (within-org public)', () => {
		const pub = project({ visibility: 'public' });
		expect(
			canView({
				orgPermissions: [],
				project: pub,
				member: null,
				orgMember: orgMember('member'),
				allowCrossOrgPublic: false
			})
		).toBe(true);
		expect(
			canView({
				orgPermissions: [],
				project: pub,
				member: null,
				orgMember: null,
				allowCrossOrgPublic: false
			})
		).toBe(false);
	});

	it('null project denies', () => {
		expect(
			canView({
				orgPermissions: [],
				project: null,
				member: null,
				orgMember: null,
				allowCrossOrgPublic: true
			})
		).toBe(false);
	});
});

// ============================================================================
// canSolve equals canView today
// ============================================================================
describe('canSolve', () => {
	it('matches canView for every visibility', () => {
		for (const v of ['public', 'org', 'private'] as const) {
			const input = {
				orgPermissions: [],
				project: project({ visibility: v }),
				member: v === 'private' ? member('viewer') : null,
				orgMember: v === 'org' ? orgMember('member') : null,
				allowCrossOrgPublic: true
			};
			expect(canSolve(input)).toBe(canView(input));
		}
	});
});

// ============================================================================
// canEdit / canManage / canEditProjectSettings
// ============================================================================
describe('canEdit', () => {
	it('project owner/editor yes; viewer no', () => {
		const base = {
			orgPermissions: [],
			project: project(),
			orgMember: null,
			allowCrossOrgPublic: true
		};
		expect(canEdit({ ...base, member: member('owner') })).toBe(true);
		expect(canEdit({ ...base, member: member('editor') })).toBe(true);
		expect(canEdit({ ...base, member: member('viewer') })).toBe(false);
		expect(canEdit({ ...base, member: null })).toBe(false);
	});

	it('manage_definitions org-perm does not grant edit', () => {
		expect(
			canEdit({
				orgPermissions: ['manage_definitions'],
				project: project({ visibility: 'public' }),
				member: null,
				orgMember: orgMember('member'),
				allowCrossOrgPublic: true
			})
		).toBe(false);
	});
});

describe('canEditProjectSettings', () => {
	it('project owner yes; editor no', () => {
		const base = {
			project: project(),
			orgMember: null,
			allowCrossOrgPublic: true
		};
		expect(canEditProjectSettings({ ...base, orgPermissions: [], member: member('owner') })).toBe(
			true
		);
		expect(
			canEditProjectSettings({
				...base,
				orgPermissions: ['manage_definitions', 'manage_projects'],
				member: member('editor')
			})
		).toBe(false);
	});
});

describe('canManage', () => {
	it('only project owner passes', () => {
		const base = {
			orgPermissions: [],
			project: project(),
			orgMember: null,
			allowCrossOrgPublic: true
		};
		expect(canManage({ ...base, member: member('owner') })).toBe(true);
		expect(canManage({ ...base, member: member('editor') })).toBe(false);
		expect(canManage({ ...base, member: null })).toBe(false);
	});
});

// ============================================================================
// canChangeVisibilityToPublic
// ============================================================================
describe('canChangeVisibilityToPublic', () => {
	it('org owner/admin can flip', () => {
		expect(
			canChangeVisibilityToPublic({
				orgMember: orgMember('owner')
			})
		).toBe(true);
		expect(
			canChangeVisibilityToPublic({
				orgMember: orgMember('admin')
			})
		).toBe(true);
	});

	it('member cannot flip', () => {
		expect(
			canChangeVisibilityToPublic({
				orgMember: orgMember('member')
			})
		).toBe(false);
	});

	it('cross-org-public flag does NOT gate the flip — only canView post-flip', () => {
		// Spec §4 line 211: with the flag off, public still flips; the meaning of
		// public narrows to within-org. The flag belongs in canView, not here.
		expect(
			canChangeVisibilityToPublic({
				orgMember: orgMember('owner')
			})
		).toBe(true);
	});
});

// ============================================================================
// canEditDefinition
// ============================================================================
describe('canEditDefinition', () => {
	it('container project: only project editors/owners', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: false });
		expect(
			canEditDefinition({
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: member('editor', 'u-editor'),
				userId: 'u-editor'
			})
		).toBe(true);
		// Uploader who isn't a project member: denied on a container project.
		expect(
			canEditDefinition({
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: null,
				userId: 'u-alice'
			})
		).toBe(false);
	});

	it('commons project: definition owner edits their own', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition({
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: null,
				userId: 'u-alice'
			})
		).toBe(true);
	});

	it('commons project: random user cannot edit someone else’s definition (Alice/Peter)', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition({
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: null,
				userId: 'u-peter'
			})
		).toBe(false);
	});

	it('commons project: project editor still moderates any definition', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition({
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: member('editor', 'u-mod'),
				userId: 'u-mod'
			})
		).toBe(true);
	});
});

// ============================================================================
// withAdminBypass wrapper
// ============================================================================
describe('withAdminBypass', () => {
	it('short-circuits true for instance_admin', () => {
		let invoked = false;
		const result = withAdminBypass(['instance_admin'], () => {
			invoked = true;
			return false; // would normally deny
		});
		expect(result).toBe(true);
		expect(invoked).toBe(false);
	});

	it('calls the rule for non-admin', () => {
		let invoked = false;
		const result = withAdminBypass([], () => {
			invoked = true;
			return true;
		});
		expect(result).toBe(true);
		expect(invoked).toBe(true);
	});
});

// ============================================================================
// checkOwnerRemoval (Permissions.md §5, §10)
// ============================================================================
describe('checkOwnerRemoval', () => {
	it('returns ok for non-owner targets regardless of confirmation', () => {
		expect(
			checkOwnerRemoval({
				target: { role: 'editor' },
				allMembers: [{ role: 'owner' }],
				confirmed: false
			})
		).toBe('ok');
		expect(
			checkOwnerRemoval({
				target: { role: 'viewer' },
				allMembers: [{ role: 'owner' }],
				confirmed: false
			})
		).toBe('ok');
	});

	it('blocks sole-owner removal even with confirmation', () => {
		expect(
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'owner' }, { role: 'editor' }],
				confirmed: true
			})
		).toBe('sole_owner');
	});

	it('owner-on-owner without confirmation needs_confirm', () => {
		expect(
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'owner' }, { role: 'owner' }],
				confirmed: false
			})
		).toBe('needs_confirm');
	});

	it('owner-on-owner with confirmation succeeds', () => {
		expect(
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'owner' }, { role: 'owner' }],
				confirmed: true
			})
		).toBe('ok');
	});

	it('three owners + confirmation succeeds (still leaves two)', () => {
		expect(
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'owner' }, { role: 'owner' }, { role: 'owner' }],
				confirmed: true
			})
		).toBe('ok');
	});

	it('zero owners (corrupt state) reports sole_owner', () => {
		// Defensive: if the caller somehow asks to remove an owner from a project
		// with no owner rows in the page, treat it as sole_owner so we never let
		// the project end up with zero owners.
		expect(
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'editor' }],
				confirmed: true
			})
		).toBe('sole_owner');
	});
});
