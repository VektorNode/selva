import { error, redirect } from '@sveltejs/kit';
import type { AuthUser, Permission, RequestContext } from '@selva/platform';
import { hasPermission, ProviderError } from '@selva/platform';
import { getOrganizationProvider } from './providers.server.js';

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

export const requireManageUsers       = (locals: Locals) => requirePermission(locals, 'manage_users');
export const requireManageCompute     = (locals: Locals) => requirePermission(locals, 'manage_compute');
export const requireManageDefinitions = (locals: Locals) => requirePermission(locals, 'manage_definitions');
export const requireManageProjects    = (locals: Locals) => requirePermission(locals, 'manage_projects');

export const assertManageUsers       = (locals: Locals) => assertPagePermission(locals, 'manage_users');
export const assertManageCompute     = (locals: Locals) => assertPagePermission(locals, 'manage_compute');
export const assertManageDefinitions = (locals: Locals) => assertPagePermission(locals, 'manage_definitions');
export const assertManageProjects    = (locals: Locals) => assertPagePermission(locals, 'manage_projects');

export const requirePlatformAdmin = (locals: Locals) => requirePermission(locals, 'platform_admin');

export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	// platform_admin can edit any project globally
	if (hasPermission(user.permissions, 'platform_admin')) return user;
	// Everyone else (including manage_definitions holders) must also be a project member
	if (!hasPermission(user.permissions, 'manage_definitions')) {
		throw error(403, `You don't have permission to do this.`);
	}
	const allowed = await getOrganizationProvider().canEdit(ctx, projectId);
	if (!allowed) throw error(403, 'You are not a member of this project.');
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
	const allowed = await getOrganizationProvider().canManage(ctx, projectId);
	if (!allowed) throw error(403, 'You are not a member of this project.');
	return user;
}
