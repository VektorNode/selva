import { error, redirect } from '@sveltejs/kit';
import type {
	AuthUser,
	OrgPermission,
	PlatformPermission,
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

export const requireManageUsers = (locals: Locals) => requirePermission(locals, 'manage_users');
export const requireManageCompute = (locals: Locals) => requirePermission(locals, 'manage_compute');
export const requireManageDefinitions = (locals: Locals) =>
	requirePermission(locals, 'manage_definitions');
export const requireManageProjects = (locals: Locals) =>
	requirePermission(locals, 'manage_projects');

export const assertManageUsers = (locals: Locals) => assertPagePermission(locals, 'manage_users');
export const assertManageCompute = (locals: Locals) =>
	assertPagePermission(locals, 'manage_compute');
export const assertManageDefinitions = (locals: Locals) =>
	assertPagePermission(locals, 'manage_definitions');
export const assertManageProjects = (locals: Locals) =>
	assertPagePermission(locals, 'manage_projects');

export const requirePlatformAdmin = (locals: Locals) => requirePermission(locals, 'platform_admin');

export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	if (hasPermission(ctx, 'platform_admin')) return user;
	if (!hasPermission(ctx, 'manage_definitions')) {
		throw error(403, `You don't have permission to do this.`);
	}
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');

	const allowed = await getProjectProvider().canEdit(ctx, projectId);
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');
	return user;
}

export async function requireCanManage(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	if (hasPermission(ctx, 'platform_admin')) return user;
	if (!hasPermission(ctx, 'manage_projects')) {
		throw error(403, `You don't have permission to do this.`);
	}
	const allowed = await getProjectProvider().canManage(ctx, projectId);
	if (!allowed) {
		const canEdit = await getProjectProvider().canEditProjectSettings(ctx, projectId);
		if (canEdit) {
			throw error(403, 'Only project owners can delete projects.');
		}
		throw error(403, 'You are not a member of this project.');
	}
	return user;
}

/**
 * Gate for adding/removing/updating project members. Same rule as editing
 * project settings: platform_admin, or a user with manage_projects who also
 * has canEditProjectSettings on the target project.
 */
export async function requireCanManageMembers(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	if (hasPermission(ctx, 'platform_admin')) return user;
	if (!hasPermission(ctx, 'manage_projects')) {
		throw error(403, `You don't have permission to do this.`);
	}
	const allowed = await getProjectProvider().canEditProjectSettings(ctx, projectId);
	if (!allowed) throw error(403, 'Only project owners can manage members.');
	return user;
}

/**
 * Gate for reading project-scoped resources (e.g. cover images). Enforces
 * visibility: private projects require membership, org/public require auth.
 */
export async function requireCanViewProject(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	if (hasPermission(ctx, 'platform_admin')) return user;

	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');

	if (project.visibility === 'private') {
		const allowed = await getProjectProvider().canEdit(ctx, projectId);
		if (!allowed) throw error(403, 'You do not have access to this project.');
	}
	return user;
}

/**
 * Load a definition by GUID and assert the user can edit it. Returns the
 * record so callers don't re-fetch. Throws 404 if the definition is missing.
 */
export async function requireEditableDefinition(locals: Locals, guid: string) {
	const { user, ctx } = requireAuthed(locals);
	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record) throw error(404, 'Definition not found');
	await requireCanEdit(locals, record.projectId);
	if (!hasPermission(ctx, 'platform_admin')) {
		const allowed = await getDefinitionMeta().canEditDefinition(
			ctx,
			record.projectId,
			user.id,
			record.ownerId
		);
		if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	}
	return { record, ctx };
}

export async function requireCanEditDefinition(
	locals: Locals,
	projectId: string,
	definitionOwnerId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(ctx, 'manage_definitions')) {
		throw error(403, `You don't have permission to do this.`);
	}
	const allowed = await getDefinitionMeta().canEditDefinition(
		ctx,
		projectId,
		user.id,
		definitionOwnerId
	);
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return user;
}
