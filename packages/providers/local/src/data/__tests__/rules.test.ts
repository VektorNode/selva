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
	canChangeOrgRole,
	withAdminBypass,
	type DefinitionAccessInput,
	type OrgMember,
	type Project,
	type ProjectAccessInput,
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

/** Default non-platform fields for ProjectAccessInput. */
function accessInput(
	overrides: Partial<ProjectAccessInput> & Pick<ProjectAccessInput, 'project'>
): ProjectAccessInput {
	return {
		orgPermissions: [],
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

function def(
	overrides: Partial<import('@selvajs/platform').DefinitionRecord> = {}
): import('@selvajs/platform').DefinitionRecord {
	const now = new Date().toISOString();
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
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...overrides
	};
}

/**
 * Default non-platform fields for DefinitionAccessInput.
 *
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

// ============================================================================
// canView
// ============================================================================
describe('canView', () => {
	it('private: returns false without a project member', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'private' }),
					allowCrossOrgPublic: true
				})
			)
		).toBe(false);
	});

	it('private: viewer role is sufficient', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'private' }),
					member: member('viewer'),
					allowCrossOrgPublic: true
				})
			)
		).toBe(true);
	});

	it('org: org member passes, non-member fails', () => {
		const pub = project({ visibility: 'org' });
		expect(
			canView(
				accessInput({ project: pub, orgMember: orgMember('member'), allowCrossOrgPublic: true })
			)
		).toBe(true);
		expect(canView(accessInput({ project: pub, allowCrossOrgPublic: true }))).toBe(false);
	});

	it('public + cross-org flag on: any authenticated user passes', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'public' }),
					allowCrossOrgPublic: true
				})
			)
		).toBe(true);
	});

	it('public + cross-org flag off: requires org membership (within-org public)', () => {
		const pub = project({ visibility: 'public' });
		expect(
			canView(
				accessInput({ project: pub, orgMember: orgMember('member'), allowCrossOrgPublic: false })
			)
		).toBe(true);
		expect(canView(accessInput({ project: pub, allowCrossOrgPublic: false }))).toBe(false);
	});

	it('null project denies', () => {
		expect(
			canView(accessInput({ project: null as unknown as Project, allowCrossOrgPublic: true }))
		).toBe(false);
	});

	// private means private from org leadership too; reclaim is the escalation path.
	it('private + org owner (no project membership): still denied', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'private' }),
					orgMember: orgMember('owner')
				})
			)
		).toBe(false);
	});

	it('private + org admin (no project membership): still denied', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'private' }),
					orgMember: orgMember('admin')
				})
			)
		).toBe(false);
	});

	it('private + org member (no project membership): denied', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'private' }),
					orgMember: orgMember('member')
				})
			)
		).toBe(false);
	});

	it('platform: instance_admin passes', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'platform' }),
					platformPermissions: ['instance_admin']
				})
			)
		).toBe(true);
	});

	it('platform: user grant passes regardless of canSolve value', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'platform' }),
					userId: 'u-grantee',
					platformGrants: [
						{
							id: 'g-1',
							projectId: 'p-1',
							granteeType: 'user',
							granteeId: 'u-grantee',
							canSolve: false,
							createdBy: 'u-admin',
							createdAt: new Date().toISOString()
						}
					]
				})
			)
		).toBe(true);
	});

	it('platform: org grant passes for acting org', () => {
		expect(
			canView(
				accessInput({
					project: project({ visibility: 'platform' }),
					actingOrgId: 'o-grantee',
					platformGrants: [
						{
							id: 'g-1',
							projectId: 'p-1',
							granteeType: 'org',
							granteeId: 'o-grantee',
							canSolve: false,
							createdBy: 'u-admin',
							createdAt: new Date().toISOString()
						}
					]
				})
			)
		).toBe(true);
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
		expect(
			canSolve(
				accessInput({
					project: project({ visibility: 'platform' }),
					platformPermissions: ['instance_admin']
				})
			)
		).toBe(true);
	});

	it('platform: canSolve=true grant passes', () => {
		expect(
			canSolve(
				accessInput({
					project: project({ visibility: 'platform' }),
					userId: 'u-grantee',
					platformGrants: [
						{
							id: 'g-1',
							projectId: 'p-1',
							granteeType: 'user',
							granteeId: 'u-grantee',
							canSolve: true,
							createdBy: 'u-admin',
							createdAt: new Date().toISOString()
						}
					]
				})
			)
		).toBe(true);
	});

	it('platform: view-only grant (canSolve=false) is denied for solve', () => {
		expect(
			canSolve(
				accessInput({
					project: project({ visibility: 'platform' }),
					userId: 'u-grantee',
					platformGrants: [
						{
							id: 'g-1',
							projectId: 'p-1',
							granteeType: 'user',
							granteeId: 'u-grantee',
							canSolve: false,
							createdBy: 'u-admin',
							createdAt: new Date().toISOString()
						}
					]
				})
			)
		).toBe(false);
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
		expect(
			canEdit(
				accessInput({
					orgPermissions: ['manage_definitions'],
					project: project({ visibility: 'public' }),
					orgMember: orgMember('member'),
					allowCrossOrgPublic: true
				})
			)
		).toBe(false);
	});

	it('platform project: instance_admin passes; project member role is ignored', () => {
		const platformProject = project({ visibility: 'platform' });
		expect(
			canEdit(
				accessInput({
					project: platformProject,
					platformPermissions: ['instance_admin']
				})
			)
		).toBe(true);
		expect(
			canEdit(
				accessInput({
					project: platformProject,
					member: member('owner')
				})
			)
		).toBe(false);
	});
});

describe('canEditProjectSettings', () => {
	it('project owner yes; editor no', () => {
		const base = accessInput({ project: project(), allowCrossOrgPublic: true });
		expect(canEditProjectSettings({ ...base, member: member('owner') })).toBe(true);
		expect(
			canEditProjectSettings({
				...base,
				orgPermissions: ['manage_definitions', 'manage_projects'],
				member: member('editor')
			})
		).toBe(false);
	});

	it('platform project: instance_admin passes; non-admin denied', () => {
		const platformProject = project({ visibility: 'platform' });
		expect(
			canEditProjectSettings(
				accessInput({
					project: platformProject,
					platformPermissions: ['instance_admin']
				})
			)
		).toBe(true);
		expect(
			canEditProjectSettings(
				accessInput({
					project: platformProject,
					member: member('owner')
				})
			)
		).toBe(false);
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
		const platformProject = project({ visibility: 'platform' });
		expect(
			canManage(
				accessInput({
					project: platformProject,
					platformPermissions: ['instance_admin']
				})
			)
		).toBe(true);
		expect(
			canManage(
				accessInput({
					project: platformProject,
					member: member('owner')
				})
			)
		).toBe(false);
	});
});

// ============================================================================
// canChangeVisibilityToPublic
// ============================================================================
describe('canChangeVisibilityToPublic', () => {
	it('org owner/admin can flip', () => {
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('owner') })).toBe(true);
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('admin') })).toBe(true);
	});

	it('member cannot flip', () => {
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('member') })).toBe(false);
	});

	it('cross-org-public flag does NOT gate the flip — only canView post-flip', () => {
		// With the flag off, public still flips; the meaning of public narrows
		// to within-org. The flag belongs in canView, not here.
		expect(canChangeVisibilityToPublic({ orgMember: orgMember('owner') })).toBe(true);
	});
});

// ============================================================================
// canEditDefinition
// ============================================================================
describe('canEditDefinition', () => {
	it('container project: only project editors/owners', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: false });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					member: member('editor', 'u-editor'),
					userId: 'u-editor'
				})
			)
		).toBe(true);
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					userId: 'u-alice'
				})
			)
		).toBe(false);
	});

	it('commons project: definition owner edits their own', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					userId: 'u-alice'
				})
			)
		).toBe(true);
	});

	it('commons project: definition owner who left the org loses edit', () => {
		// `ownerId` records who uploaded, not who still belongs. Without this
		// check, flipping `autoJoinOnUpload` on hands a departed contractor edit,
		// delete and share-link authority over everything they ever uploaded —
		// retroactively, and with no action taken against them.
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					orgMember: null,
					userId: 'u-alice'
				})
			)
		).toBe(false);
	});

	it('container project: org membership is not consulted', () => {
		// The commons test above must not be read as "org membership grants edit".
		// In container mode project role is the whole rule, so an org member with
		// no project role stays out and a project editor stays in.
		const p = project({ visibility: 'org', autoJoinOnUpload: false });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					userId: 'u-alice'
				})
			)
		).toBe(false);
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					member: member('editor', 'u-alice'),
					orgMember: null,
					userId: 'u-alice'
				})
			)
		).toBe(true);
	});

	it('commons project: random user cannot edit someone else’s definition (Alice/Peter)', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					userId: 'u-peter'
				})
			)
		).toBe(false);
	});

	it('commons project: project editor still moderates any definition', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: true });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def({ ownerId: 'u-alice' }),
					member: member('editor', 'u-mod'),
					userId: 'u-mod'
				})
			)
		).toBe(true);
	});

	it('platform project: instance_admin passes', () => {
		const p = project({ visibility: 'platform' });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def(),
					userId: 'u-admin',
					platformPermissions: ['instance_admin']
				})
			)
		).toBe(true);
	});

	it('platform project: grant holder cannot edit definitions', () => {
		const p = project({ visibility: 'platform' });
		expect(
			canEditDefinition(
				defAccessInput({
					project: p,
					definition: def(),
					userId: 'u-grantee'
				})
			)
		).toBe(false);
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
// checkOwnerRemoval
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
		// Defensive: no owner rows in the page still reports sole_owner, so a
		// corrupt/incomplete member list can't be used to remove the last owner.
		expect(
			checkOwnerRemoval({
				target: { role: 'owner' },
				allMembers: [{ role: 'editor' }],
				confirmed: true
			})
		).toBe('sole_owner');
	});
});

// ============================================================================
// canChangeOrgRole
// ============================================================================
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

	it('reads the membership row, not the org owner_id', () => {
		// `Organization.ownerId` and the membership row are separate fields that
		// can disagree — `seedAcme` has exactly that shape. Only the row is
		// authority here, so an `admin` row is refused regardless of who the org
		// claims its owner is.
		expect(canChangeOrgRole({ actorMember: orgMember('admin', 'u-founder'), role: 'owner' })).toBe(
			false
		);
	});
});
