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

/** Throws 403 — use in API routes. */
export function requirePermission(locals: Locals, permission: AnyPermission): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(ctx, permission)) {
		throw error(403, `You don't have permission to do this.`);
	}
	return user;
}

/** Redirects to /admin — use in page load functions. */
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

/**
 * Every project/definition gate funnels through this so the `instance_admin`
 * bypass lives in one place — the future audit-log hook point.
 */
async function bypassOrRun(
	ctx: RequestContext,
	check: () => Promise<boolean>
): Promise<boolean> {
	if (hasPermission(ctx, 'instance_admin')) return true;
	return await check();
}

async function loadProjectOr404(ctx: RequestContext, projectId: string): Promise<Project> {
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');
	return project;
}

export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		await loadProjectOr404(ctx, projectId);
		return await getProjectProvider().canEdit(ctx, projectId);
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');
	return user;
}

export async function requireCanManage(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, () =>
		getProjectProvider().canManage(ctx, projectId)
	);
	if (!allowed) throw error(403, 'Only project owners can manage this project.');
	return user;
}

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

export async function requireCanViewProject(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
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
		return true;
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return user;
}

/**
 * Same shape as view today; kept separate so future cost gating lands here
 * without touching view semantics. `viewer` project role passes.
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
		return true;
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return { user, ctx, project };
}

/** Loads the record and gates editing. Returns the record so callers skip a re-fetch. */
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
