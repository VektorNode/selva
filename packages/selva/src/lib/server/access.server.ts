import { error, redirect } from '@sveltejs/kit';
import type {
	AuthUser,
	DefinitionRecord,
	OrgPermission,
	PlatformPermission,
	Project,
	RequestContext
} from '@selvajs/platform';
import {
	ALL_PLATFORM_PERMISSIONS,
	hasPermission,
	canReclaim,
	canCreateProject,
	canView,
	canSolve,
	canEdit,
	canManage,
	canEditProjectSettings,
	canEditDefinition
} from '@selvajs/platform';
import { createProjectAccessInputBuilder } from '@selvajs/server/access';
import {
	getProjectProvider,
	getDefinitionMeta,
	getOrganizationProvider,
	getPlatformProjectGrantStore,
	flag
} from './providers.server.js';
import { handleApiError, apiError, ApiErrorCode } from './api-errors.js';

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
export const assertManageDefinitions = (locals: Locals) =>
	assertPagePermission(locals, 'manage_definitions');
export const assertManageProjects = (locals: Locals) =>
	assertPagePermission(locals, 'manage_projects');

export const requireInstanceAdmin = (locals: Locals) => requirePermission(locals, 'instance_admin');

/**
 * Tenancy gate for `/api/v1/orgs/{orgId}/…`. The URL id is never trusted alone
 * — the acting context decides which tenant a request applies to, so a
 * mismatch is 403 rather than a silent read of the caller's own org.
 */
export function requireActingOrg(
	locals: Locals,
	orgId: string | undefined
): { ctx: RequestContext; orgId: string } {
	const ctx = locals.ctx;
	if (!ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	if (!orgId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing org ID');
	if (!ctx.actingOrgId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'No active organization');
	if (ctx.actingOrgId !== orgId) {
		apiError(403, ApiErrorCode.FORBIDDEN, 'Acting org does not match the target org.');
	}
	return { ctx, orgId };
}

/**
 * Gate for routes reachable by any platform-class permission holder (e.g. the
 * `/admin` shell — `instance_admin`, `manage_compute`, `manage_instance_users`,
 * or `manage_updates` all qualify). Org-scope permissions never admit entry:
 * org admins do not belong on platform-scoped surfaces.
 *
 * Throws 403 — use in API routes.
 */
export function requireAnyPlatformPermission(locals: Locals): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	const allowed = ALL_PLATFORM_PERMISSIONS.some((p) => hasPermission(ctx, p));
	if (!allowed) throw error(403, `You don't have permission to do this.`);
	return user;
}

/** Redirects to /library — use in page load functions on platform-scoped routes. */
export function assertAnyPlatformPermission(locals: Locals): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	const allowed = ALL_PLATFORM_PERMISSIONS.some((p) => hasPermission(ctx, p));
	if (!allowed) redirect(303, '/library');
	return user;
}

/**
 * Management-scope bypass — used for org governance and project management
 * actions (Reclaim, create project, delete project, manage members, edit
 * settings). `instance_admin` bypasses these so platform staff can administer
 * the instance without being a member of every org.
 *
 * NOT used for content access (view, solve, edit definitions):
 * `instance_admin` follows the same `canView`/`canEdit` rules as any other
 * user there, keeping blast radius small and forcing content escalation
 * through Reclaim, which leaves an audit trail.
 */
async function managementBypassOrRun(
	ctx: RequestContext,
	check: () => Promise<boolean>
): Promise<boolean> {
	if (hasPermission(ctx, 'instance_admin')) return true;
	return await check();
}

// Content-scope check — NO `instance_admin` bypass. `canView`, `canSolve`,
// `canEdit`, and `canEditDefinition` run as-is regardless of platform role;
// platform staff use Reclaim first if they need content access.
async function contentCheck(check: () => Promise<boolean>): Promise<boolean> {
	return await check();
}

async function loadProjectOr404(ctx: RequestContext, projectId: string): Promise<Project> {
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');
	return project;
}

// Rule-input assembly (the "which rows does each visibility need" knowledge)
// lives in `@selvajs/server/access`; this binding wires it to the app's
// lazily-initialized providers and flag reads.
const accessInputs = createProjectAccessInputBuilder({
	getProjectMember: (ctx, projectId, userId) =>
		getProjectProvider().getProjectMember(ctx, projectId, userId),
	getOrgMember: (ctx, orgId, userId) => getOrganizationProvider().getOrgMember(ctx, orgId, userId),
	listPlatformGrants: (ctx, projectId) =>
		getPlatformProjectGrantStore().listByProject(ctx, projectId),
	flags: () => ({
		allowCrossOrgPublic: flag('ALLOW_CROSS_ORG_PUBLIC'),
		enablePlatformProjects: flag('ENABLE_PLATFORM_PROJECTS')
	})
});

const buildProjectAccessInput = accessInputs.buildProjectAccessInput;
export const projectAccessInputFromRows = accessInputs.projectAccessInputFromRows;

export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await contentCheck(async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canEdit(await buildProjectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');
	return user;
}

/**
 * Gates creation of a *new* definition. Container projects require project
 * owner/editor (canEdit). Commons projects (`autoJoinOnUpload=true`) accept
 * any authenticated user — the handler stamps `ownerId = user.id` so the
 * uploader becomes the owner.
 */
export async function requireCanCreateDefinition(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await contentCheck(async () => {
		if (project.autoJoinOnUpload) return true;
		return canEdit(await buildProjectAccessInput(ctx, project));
	});
	if (!allowed) {
		throw error(403, 'You do not have permission to upload definitions to this project.');
	}
	return { user, ctx, project };
}

/**
 * Org-content gate — the caller must be a member of `orgId`. Used by the
 * file-serving proxy for org-private assets (e.g. pricing sheets under
 * `orgs/{id}/private/*`). Org membership is the only rule; runs through
 * `contentCheck` (no `instance_admin` bypass) — platform staff use Reclaim
 * if they need access without membership.
 *
 * Throws 401 unauthenticated, 403 when not a member.
 */
export async function requireCanViewOrg(locals: Locals, orgId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await contentCheck(async () => {
		const member = await getOrganizationProvider().getOrgMember(ctx, orgId, ctx.userId);
		return member !== null;
	});
	if (!allowed) throw error(403, 'You do not have access to this organization.');
	return user;
}

/**
 * Project members must belong to the project's parent org. Enforced at the
 * rule layer, not as a DB constraint, to leave room for cross-org guests
 * later without a schema migration.
 */
export async function requireTargetIsOrgMember(
	locals: Locals,
	orgId: string,
	targetUserId: string
): Promise<void> {
	const { ctx } = requireAuthed(locals);
	const member = await getOrganizationProvider().getOrgMember(ctx, orgId, targetUserId);
	if (!member) {
		throw error(400, 'User must be a member of this organization to be added to a project.');
	}
}

/**
 * `canReclaim` — org owner/admin escape hatch. Returns the project so the
 * handler can use its `orgId` without re-fetching.
 */
export async function requireCanReclaim(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await managementBypassOrRun(ctx, async () => {
		const orgMember = await getOrganizationProvider().getOrgMember(ctx, project.orgId, ctx.userId);
		return canReclaim({
			project,
			orgMember,
			actingOrgId: ctx.actingOrgId ?? null
		});
	});
	if (!allowed) {
		throw error(403, 'Only org owners or admins of this project’s org can reclaim it.');
	}
	return { user, ctx, project };
}

/**
 * `canCreateProject` — owner/admin always; member needs `manage_projects`.
 * Tenancy is enforced via `actingOrgId`.
 */
export async function requireCanCreateProject(
	locals: Locals,
	targetOrgId: string
): Promise<{ user: AuthUser; ctx: RequestContext }> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await managementBypassOrRun(ctx, async () => {
		const orgMember = await getOrganizationProvider().getOrgMember(ctx, targetOrgId, ctx.userId);
		return canCreateProject({
			orgPermissions: ctx.orgPermissions,
			orgMember,
			actingOrgId: ctx.actingOrgId ?? null,
			targetOrgId
		});
	});
	if (!allowed) throw error(403, 'You do not have permission to create projects in this org.');
	return { user, ctx };
}

export async function requireCanManage(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await managementBypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canManage(await buildProjectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'Only project owners can manage this project.');
	return user;
}

export async function requireCanManageMembers(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await managementBypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canManage(await buildProjectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'Only project owners can manage members.');
	return user;
}

// Owner-only gate for project settings, centralized so PATCH
// /api/projects/[id] matches the rest of the access layer.
export async function requireCanEditProjectSettings(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await managementBypassOrRun(ctx, async () =>
		canEditProjectSettings(await buildProjectAccessInput(ctx, project))
	);
	if (!allowed) throw error(403, 'Only project owners can edit project settings.');
	return { user, ctx, project };
}

export async function requireCanViewProject(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await contentCheck(async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canView(await buildProjectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return user;
}

/**
 * Solve gating. Today `canSolve === canView` for non-platform projects, but
 * the rule lives in its own function so future cost-gating (quotas, rate
 * limits) lands without touching view semantics. `viewer` project role
 * passes; platform projects narrow to grants with `canSolve=true`.
 */
export async function requireCanSolve(
	locals: Locals,
	projectId: string,
	// Callers that already loaded the project (e.g. the solve endpoint, which
	// reads orgId/pin off it) pass it to skip a redundant `getProject` here.
	preloadedProject?: Project
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = preloadedProject ?? (await loadProjectOr404(ctx, projectId));
	const allowed = await contentCheck(async () =>
		canSolve(await buildProjectAccessInput(ctx, project))
	);
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return { user, ctx, project };
}

/**
 * Loads the record and gates editing. Returns the record AND the project it
 * loads for the gate, so callers skip a re-fetch of either.
 */
export async function requireEditableDefinition(locals: Locals, guid: string) {
	const { ctx } = requireAuthed(locals);
	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record) throw error(404, 'Definition not found');
	// Load project + member once up front; `project` is returned for reuse.
	const [project, member] = await Promise.all([
		getProjectProvider().getProject(ctx, record.projectId),
		getProjectProvider().getProjectMember(ctx, record.projectId, ctx.userId)
	]);
	const allowed = await contentCheck(async () =>
		canEditDefinition({
			project,
			definition: record,
			member,
			userId: ctx.userId,
			platformPermissions: ctx.platformPermissions,
			enablePlatformProjects: flag('ENABLE_PLATFORM_PROJECTS')
		})
	);
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return { record, ctx, project };
}

export async function requireCanEditDefinition(
	locals: Locals,
	projectId: string,
	definitionGuid: string,
	// Callers that already loaded the project and/or definition (e.g. the solve
	// endpoint) pass them to skip the redundant fetches inside the gate. The
	// member row still loads here (the caller doesn't have it).
	preloaded?: { project?: Project | null; definition?: DefinitionRecord | null }
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await contentCheck(async () => {
		const [project, definition, member] = await Promise.all([
			preloaded?.project !== undefined
				? Promise.resolve(preloaded.project)
				: getProjectProvider().getProject(ctx, projectId),
			preloaded?.definition !== undefined
				? Promise.resolve(preloaded.definition)
				: getDefinitionMeta().get(ctx, definitionGuid),
			getProjectProvider().getProjectMember(ctx, projectId, ctx.userId)
		]);
		return canEditDefinition({
			project,
			definition,
			member,
			userId: ctx.userId,
			platformPermissions: ctx.platformPermissions,
			enablePlatformProjects: flag('ENABLE_PLATFORM_PROJECTS')
		});
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return user;
}
