/**
 * Pure-rule tests for @selva/platform/access. These exercise the rule
 * functions directly with constructed inputs — no storage, no adapters.
 *
 * Lives in the local-provider package because platform doesn't run its own
 * vitest. Any rule regression surfaces here before a store-level test can
 * even get a chance to fail.
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
	withAdminBypass,
	type DefinitionRecord,
	type OrgMember,
	type PlatformPermission,
	type Project,
	type ProjectMember
} from '@selva/platform';

// ── helpers ────────────────────────────────────────────────────────────────

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
		allowAnonymous: false,
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
		fileExt: 'gh',
		displayName: 'D',
		history: [],
		maxHistory: 0,
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

const noPerms: readonly PlatformPermission[] = [];

// ── canView ────────────────────────────────────────────────────────────────

describe('canView', () => {
	it('private: returns false without a project member', () => {
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: project({ visibility: 'private' }),
				member: null,
				orgMember: null
			})
		).toBe(false);
	});

	it('private: viewer role is sufficient', () => {
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: project({ visibility: 'private' }),
				member: member('viewer'),
				orgMember: null
			})
		).toBe(true);
	});

	it('org: org member passes, non-member fails', () => {
		const pub = project({ visibility: 'org' });
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: pub,
				member: null,
				orgMember: orgMember('member')
			})
		).toBe(true);
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: pub,
				member: null,
				orgMember: null
			})
		).toBe(false);
	});

	it('public: any authenticated user passes', () => {
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: project({ visibility: 'public' }),
				member: null,
				orgMember: null
			})
		).toBe(true);
	});

	it('public + allowAnonymous: anonymous passes', () => {
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: project({ visibility: 'public', allowAnonymous: true }),
				member: null,
				orgMember: null,
				anonymous: true
			})
		).toBe(true);
	});

	it('public without allowAnonymous: anonymous denied', () => {
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: project({ visibility: 'public', allowAnonymous: false }),
				member: null,
				orgMember: null,
				anonymous: true
			})
		).toBe(false);
	});

	it('null project denies', () => {
		expect(
			canView({
				platformPermissions: noPerms,
				orgPermissions: [],
				project: null,
				member: null,
				orgMember: null
			})
		).toBe(false);
	});
});

// ── canSolve equals canView today ─────────────────────────────────────────

describe('canSolve', () => {
	it('matches canView for every visibility (A1)', () => {
		for (const v of ['public', 'org', 'private'] as const) {
			const input = {
				platformPermissions: noPerms,
				orgPermissions: [],
				project: project({ visibility: v }),
				member: v === 'private' ? member('viewer') : null,
				orgMember: v === 'org' ? orgMember('member') : null
			};
			expect(canSolve(input)).toBe(canView(input));
		}
	});
});

// ── canEdit / canManage / canEditProjectSettings ──────────────────────────

describe('canEdit', () => {
	it('project owner/editor yes; viewer no', () => {
		const base = {
			platformPermissions: noPerms,
			orgPermissions: [],
			project: project(),
			orgMember: null
		};
		expect(canEdit({ ...base, member: member('owner') })).toBe(true);
		expect(canEdit({ ...base, member: member('editor') })).toBe(true);
		expect(canEdit({ ...base, member: member('viewer') })).toBe(false);
		expect(canEdit({ ...base, member: null })).toBe(false);
	});

	it('manage_definitions org-perm no longer grants edit (A3)', () => {
		expect(
			canEdit({
				platformPermissions: noPerms,
				orgPermissions: ['manage_definitions'],
				project: project({ visibility: 'public' }),
				member: null,
				orgMember: orgMember('member')
			})
		).toBe(false);
	});
});

describe('canEditProjectSettings', () => {
	it('project owner yes; editor no (A4 collapse)', () => {
		const base = {
			platformPermissions: noPerms,
			project: project(),
			orgMember: null
		};
		expect(
			canEditProjectSettings({ ...base, orgPermissions: [], member: member('owner') })
		).toBe(true);
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
			platformPermissions: noPerms,
			orgPermissions: [],
			project: project(),
			orgMember: null
		};
		expect(canManage({ ...base, member: member('owner') })).toBe(true);
		expect(canManage({ ...base, member: member('editor') })).toBe(false);
		expect(canManage({ ...base, member: null })).toBe(false);
	});
});

// ── canChangeVisibilityToPublic (A6) ──────────────────────────────────────

describe('canChangeVisibilityToPublic', () => {
	it('org owner/admin can flip when flag is on', () => {
		expect(
			canChangeVisibilityToPublic({
				platformPermissions: noPerms,
				orgMember: orgMember('owner'),
				allowCrossOrgPublic: true
			})
		).toBe(true);
		expect(
			canChangeVisibilityToPublic({
				platformPermissions: noPerms,
				orgMember: orgMember('admin'),
				allowCrossOrgPublic: true
			})
		).toBe(true);
	});

	it('member cannot even with flag on', () => {
		expect(
			canChangeVisibilityToPublic({
				platformPermissions: noPerms,
				orgMember: orgMember('member'),
				allowCrossOrgPublic: true
			})
		).toBe(false);
	});

	it('denied when platform flag is off regardless of role', () => {
		expect(
			canChangeVisibilityToPublic({
				platformPermissions: noPerms,
				orgMember: orgMember('owner'),
				allowCrossOrgPublic: false
			})
		).toBe(false);
	});
});

// ── canEditDefinition (A3 + B4 commons) ───────────────────────────────────

describe('canEditDefinition', () => {
	it('container project: only project editors/owners', () => {
		const p = project({ visibility: 'public', autoJoinOnUpload: false });
		expect(
			canEditDefinition({
				platformPermissions: noPerms,
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: member('editor', 'u-editor'),
				userId: 'u-editor'
			})
		).toBe(true);
		// Uploader who isn't a project member: denied on a container project.
		expect(
			canEditDefinition({
				platformPermissions: noPerms,
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
				platformPermissions: noPerms,
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
				platformPermissions: noPerms,
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
				platformPermissions: noPerms,
				project: p,
				definition: def({ ownerId: 'u-alice' }),
				member: member('editor', 'u-mod'),
				userId: 'u-mod'
			})
		).toBe(true);
	});
});

// ── withAdminBypass wrapper (A5) ──────────────────────────────────────────

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
