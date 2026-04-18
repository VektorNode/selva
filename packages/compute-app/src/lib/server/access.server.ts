import { error } from '@sveltejs/kit';
import type { AuthUser } from '@selva/platform/auth';
import { ProviderError } from '@selva/platform';
import { getOrganizationProvider } from './providers.server.js';

export function throwProviderError(err: unknown, fallback: string): never {
	if (err && typeof err === 'object' && 'status' in err) throw err;
	if (err instanceof ProviderError) throw error(err.statusCode, err.message);
	throw error(500, fallback);
}

interface Locals {
	user?: AuthUser;
}

export function requirePlatformAdmin(locals: Locals): AuthUser {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');
	if (user.role !== 'platform_admin') throw error(403, 'Platform admin access required');
	return user;
}

export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');
	if (user.role === 'platform_admin') return user;
	const allowed = await getOrganizationProvider().canEdit(user.id, projectId);
	if (!allowed) throw error(403, 'You do not have edit access to this project');
	return user;
}

export async function requireCanManage(locals: Locals, projectId: string): Promise<AuthUser> {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');
	if (user.role === 'platform_admin') return user;
	const allowed = await getOrganizationProvider().canManage(user.id, projectId);
	if (!allowed) throw error(403, 'You do not have manage access to this project');
	return user;
}
