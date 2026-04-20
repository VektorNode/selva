import { error, redirect } from '@sveltejs/kit';
import type { AuthUser, Permission, RequestContext } from '@selva/platform';
import { hasPermission, ProviderError } from '@selva/platform';
import { getProjectProvider, getDefinitionMeta } from './providers.server.js';

export function throwProviderError(err: unknown, fallback: string): never {
	if (err && typeof err === 'object' && 'status' in err) throw err;
	if (err instanceof ProviderError) throw error(err.statusCode, err.message);
	throw error(500, fallback);
}

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
export function requirePermission(locals: Locals, permission: Permission): AuthUser {
	const { user } = requireAuthed(locals);
	if (!hasPermission(user.permissions, permission)) {
		throw error(403, `You don't have permission to do this.`);
	}
	return user;
}

/** Same check but redirects to /admin — use in page load functions. */
export function assertPagePermission(locals: Locals, permission: Permission): AuthUser {
	const { user } = requireAuthed(locals);
	if (!hasPermission(user.permissions, permission)) {
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
	// platform_admin can edit any project globally
	if (hasPermission(user.permissions, 'platform_admin')) return user;
	// Must have manage_definitions permission
	if (!hasPermission(user.permissions, 'manage_definitions')) {
		throw error(403, `You don't have permission to do this.`);
	}
	// Check project access based on visibility
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');

	if (project.visibility === 'private') {
		// Private: user must be a project member
		const allowed = await getProjectProvider().canEdit(ctx, projectId);
		if (!allowed) throw error(403, 'You are not a member of this project.');
	}
	// For 'org' and 'public': org membership is checked by locals.ctx which is org-scoped
	// Implicitly allowed if they have manage_definitions permission
	return user;
}

export async function requireCanManage(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	// platform_admin can manage any project globally
	if (hasPermission(user.permissions, 'platform_admin')) return user;
	// Everyone else (including manage_projects holders) must also be a project member
	if (!hasPermission(user.permissions, 'manage_projects')) {
		throw error(403, `You don't have permission to do this.`);
	}
	const allowed = await getProjectProvider().canManage(ctx, projectId);
	if (!allowed) {
		// Check if they're a member but just don't have owner role
		const canEdit = await getProjectProvider().canEditProjectSettings(ctx, projectId);
		if (canEdit) {
			throw error(403, 'Only project owners can delete projects.');
		}
		throw error(403, 'You are not a member of this project.');
	}
	return user;
}

export async function requireCanEditDefinition(
	locals: Locals,
	projectId: string,
	definitionOwnerId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(user.permissions, 'manage_definitions')) {
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
