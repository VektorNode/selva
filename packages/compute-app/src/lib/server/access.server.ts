import { error, redirect } from '@sveltejs/kit';
import type {
	AuthUser,
	OrgPermission,
	PlatformPermission,
	Project,
	RequestContext
} from '@selva/platform';
import { hasPermission } from '@selva/platform';
import { getProjectProvider, getDefinitionMeta } from './providers.server.js';
import { handleApiError } from './api-errors.js';

// Kept for backwards compatibility with existing callers; prefer handleApiError.
export const throwProviderError = handleApiError;

type AnyPermission = PlatformPermission | OrgPermission;

interface Locals {
	user?: AuthUser;
	ctx?: RequestContext;
}

function requireAuthed(locals: Locals): { user: AuthUser; ctx: RequestContext } {
	const { user, ctx } = locals;
	if (!user || !ctx) throw error(401, 'Unauthorized');
	return { user, ctx };
}

/** Assert the current user holds a specific permission. Throws 403 — use in API routes. */
export function requirePermission(locals: Locals, permission: AnyPermission): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(ctx, permission)) {
		throw error(403, `You don't have permission to do this.`);
	}
	return user;
}

/** Same check but redirects to /admin — use in page load functions. */
export function assertPagePermission(locals: Locals, permission: AnyPermission): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(ctx, permission)) {
		redirect(303, '/admin');
	}
	return user;
}

export const requireManageInstanceUsers = (locals: Locals) =>
	requirePermission(locals, 'manage_instance_users');
export const requireManageCompute = (locals: Locals) => requirePermission(locals, 'manage_compute');
export const requireManageUpdates = (locals: Locals) =>
	requirePermission(locals, 'manage_updates');
export const requireManageOrgMembers = (locals: Locals) =>
	requirePermission(locals, 'manage_org_members');
export const requireManageOrgCompute = (locals: Locals) =>
	requirePermission(locals, 'manage_org_compute');
export const requireManageDefinitions = (locals: Locals) =>
	requirePermission(locals, 'manage_definitions');
export const requireManageProjects = (locals: Locals) =>
	requirePermission(locals, 'manage_projects');

export const assertManageInstanceUsers = (locals: Locals) =>
	assertPagePermission(locals, 'manage_instance_users');
export const assertManageCompute = (locals: Locals) =>
	assertPagePermission(locals, 'manage_compute');
export const assertManageUpdates = (locals: Locals) =>
	assertPagePermission(locals, 'manage_updates');
export const assertManageDefinitions = (locals: Locals) =>
	assertPagePermission(locals, 'manage_definitions');
export const assertManageProjects = (locals: Locals) =>
	assertPagePermission(locals, 'manage_projects');

export const requireInstanceAdmin = (locals: Locals) =>
	requirePermission(locals, 'instance_admin');

// ============================================================================
// Centralized instance_admin bypass (A5)
// ============================================================================
//
// All project/definition gates below funnel through this helper so the
// bypass exists in exactly one place. Future audit-log hook point: any call
// that short-circuits here is an instance_admin touch on tenant data.

async function bypassOrRun(
	ctx: RequestContext,
	check: () => Promise<boolean>
): Promise<boolean> {
	if (hasPermission(ctx, 'instance_admin')) return true;
	return await check();
}

// ============================================================================
// Project gates
// ============================================================================

/**
 * Load the project or 404 — shared by every project gate below so callers
 * can't accidentally bypass the deleted-project check.
 */
async function loadProjectOr404(ctx: RequestContext, projectId: string): Promise<Project> {
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');
	return project;
}

/**
 * Gate for editing definitions in a project (spec §5 `canEdit`).
 * Project role is authoritative — project owner or editor only. Routes that
 * act on a *specific* definition should use `requireCanEditDefinition` for
 * the commons-model carve-out.
 */
export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		await loadProjectOr404(ctx, projectId);
		return await getProjectProvider().canEdit(ctx, projectId);
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');
	return user;
}

/** Gate for deleting the project, managing members, and ownership transfer. */
export async function requireCanManage(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, () =>
		getProjectProvider().canManage(ctx, projectId)
	);
	if (!allowed) throw error(403, 'Only project owners can manage this project.');
	return user;
}

/**
 * Gate for adding/removing/updating project members. Same rule as `canManage`
 * (spec §5). An owner-on-owner removal confirm is a handler concern.
 */
export async function requireCanManageMembers(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, () =>
		getProjectProvider().canManage(ctx, projectId)
	);
	if (!allowed) throw error(403, 'Only project owners can manage members.');
	return user;
}

/**
 * Gate for viewing a project or any resource scoped to it (cover images,
 * project details). Enforces the visibility rule at the call site instead of
 * relying on "public projects are public by default."
 *
 * - private → must be able to `canEdit` (member of any role); see also
 *   `requireCanSolve` which treats `viewer` role as sufficient.
 * - org/public → authenticated users pass.
 */
export async function requireCanViewProject(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		if (project.visibility === 'private') {
			// Private: membership required. Any role counts.
			const member = await getProjectProvider().getProjectMember(
				ctx,
				projectId,
				ctx.userId
			);
			return member != null;
		}
		if (project.visibility === 'org') {
			// Org: caller's acting org must match, and they must be an org member.
			if (ctx.actingOrgId !== project.orgId) return false;
			return true;
		}
		// public: any authenticated user.
		return true;
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return user;
}

// ============================================================================
// Solve gate (A2) — visibility + membership, not "any authenticated user"
// ============================================================================

/**
 * Gate for solving. **Today: same shape as `requireCanViewProject`** —
 * solving is granted exactly when viewing is, and the `viewer` project role
 * is explicitly sufficient (spec Q31). Future cost gating lands here without
 * touching `canView` semantics.
 *
 * Returns the resolved project so callers can pass it downstream (e.g. to
 * pick the right compute server).
 */
export async function requireCanSolve(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);

	const allowed = await bypassOrRun(ctx, async () => {
		if (project.visibility === 'private') {
			const member = await getProjectProvider().getProjectMember(
				ctx,
				projectId,
				ctx.userId
			);
			return member != null;
		}
		if (project.visibility === 'org') {
			return ctx.actingOrgId === project.orgId;
		}
		// public: anonymous branch is handled by a distinct route entry point.
		return true;
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return { user, ctx, project };
}

// ============================================================================
// Definition gates (A3)
// ============================================================================

/**
 * Load a definition by GUID, assert the caller can edit it, and return the
 * record so callers don't re-fetch. The underlying rule is project-role-
 * authoritative with a commons-model carve-out (spec §5 `canEditDefinition`).
 */
export async function requireEditableDefinition(locals: Locals, guid: string) {
	const { ctx } = requireAuthed(locals);
	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record) throw error(404, 'Definition not found');
	const allowed = await bypassOrRun(ctx, () =>
		getDefinitionMeta().canEditDefinition(ctx, record.projectId, record.guid)
	);
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return { record, ctx };
}

/**
 * Permission-only variant: assert the caller can edit a specific definition
 * given its project and guid. Used by upload handlers that already know the
 * target project (e.g. uploading a new definition into a commons project
 * where the record may not exist yet).
 */
export async function requireCanEditDefinition(
	locals: Locals,
	projectId: string,
	definitionGuid: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, () =>
		getDefinitionMeta().canEditDefinition(ctx, projectId, definitionGuid)
	);
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return user;
}
