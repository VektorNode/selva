import { error, redirect } from '@sveltejs/kit';
import type {
	AuthUser,
	OrgPermission,
	PlatformPermission,
	Project,
	ProjectAccessInput,
	ProjectMember,
	RequestContext
} from '@selva/platform';
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
} from '@selva/platform';
import {
	getProjectProvider,
	getDefinitionMeta,
	getOrganizationProvider,
	flag
} from './providers.server.js';
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
export const requireManageUpdates = (locals: Locals) => requirePermission(locals, 'manage_updates');
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

export const requireInstanceAdmin = (locals: Locals) => requirePermission(locals, 'instance_admin');

/**
 * Gate for routes that may be reached by any platform-class permission holder
 * (e.g. the `/admin` shell — `instance_admin`, `manage_compute`,
 * `manage_instance_users`, or `manage_updates` all qualify). Org-scope
 * permissions never admit entry: org admins do not belong on platform-scoped
 * surfaces.
 *
 * Throws 403 — use in API routes.
 */
export function requireAnyPlatformPermission(locals: Locals): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	const allowed = ALL_PLATFORM_PERMISSIONS.some((p) => hasPermission(ctx, p));
	if (!allowed) throw error(403, `You don't have permission to do this.`);
	return user;
}

/** Redirects to /app — use in page load functions on platform-scoped routes. */
export function assertAnyPlatformPermission(locals: Locals): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	const allowed = ALL_PLATFORM_PERMISSIONS.some((p) => hasPermission(ctx, p));
	if (!allowed) redirect(303, '/app');
	return user;
}

/**
 * Every project/definition gate funnels through this so the `instance_admin`
 * bypass lives in one place — the future audit-log hook point.
 */
async function bypassOrRun(ctx: RequestContext, check: () => Promise<boolean>): Promise<boolean> {
	if (hasPermission(ctx, 'instance_admin')) return true;
	return await check();
}

async function loadProjectOr404(ctx: RequestContext, projectId: string): Promise<Project> {
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');
	return project;
}

/**
 * Build the rule input for project-role gates (`canEdit`, `canManage`,
 * `canEditProjectSettings`). Loads the caller's project membership row;
 * `orgMember` and `allowCrossOrgPublic` are unused by these rules so we
 * pass placeholders.
 */
async function projectAccessInput(
	ctx: RequestContext,
	project: Project
): Promise<ProjectAccessInput> {
	const member: ProjectMember | null = await getProjectProvider().getProjectMember(
		ctx,
		project.id,
		ctx.userId
	);
	return {
		platformPermissions: ctx.platformPermissions,
		orgPermissions: ctx.orgPermissions,
		project,
		member,
		orgMember: null,
		allowCrossOrgPublic: false
	};
}

export async function requireCanEdit(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canEdit(await projectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');
	return user;
}

/**
 * Gate creation of a *new* definition. Container projects require project
 * owner/editor (canEdit). Commons projects (`autoJoinOnUpload=true`) accept
 * any authenticated user — the handler stamps `ownerId = user.id` so the
 * uploader becomes the definition owner.
 */
export async function requireCanCreateDefinition(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await bypassOrRun(ctx, async () => {
		if (project.autoJoinOnUpload) return true;
		return canEdit(await projectAccessInput(ctx, project));
	});
	if (!allowed) {
		throw error(403, 'You do not have permission to upload definitions to this project.');
	}
	return { user, ctx, project };
}

/**
 * Project members must be members of the project's parent org (§4). Enforced
 * at the rule layer, not as a DB constraint, to leave room for cross-org
 * guests later without a schema migration.
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
 * §5 `canReclaim` — org owner/admin escape hatch. Returns the project so the
 * handler can use its `orgId` without re-fetching.
 */
export async function requireCanReclaim(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await bypassOrRun(ctx, async () => {
		const orgMember = await getOrganizationProvider().getOrgMember(ctx, project.orgId, ctx.userId);
		return canReclaim({
			platformPermissions: ctx.platformPermissions,
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
 * §5 `canCreateProject` — owner/admin always; member needs `manage_projects`.
 * Tenancy is enforced via `actingOrgId`.
 */
export async function requireCanCreateProject(
	locals: Locals,
	targetOrgId: string
): Promise<{ user: AuthUser; ctx: RequestContext }> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const orgMember = await getOrganizationProvider().getOrgMember(ctx, targetOrgId, ctx.userId);
		return canCreateProject({
			platformPermissions: ctx.platformPermissions,
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
	const allowed = await bypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canManage(await projectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'Only project owners can manage this project.');
	return user;
}

export async function requireCanManageMembers(
	locals: Locals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return canManage(await projectAccessInput(ctx, project));
	});
	if (!allowed) throw error(403, 'Only project owners can manage members.');
	return user;
}

/**
 * Owner-only gate for project settings. Centralized so PATCH /api/projects/[id]
 * matches the rest of the access layer (one place loads the entities + calls
 * the rule).
 */
export async function requireCanEditProjectSettings(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await bypassOrRun(ctx, async () =>
		canEditProjectSettings(await projectAccessInput(ctx, project))
	);
	if (!allowed) throw error(403, 'Only project owners can edit project settings.');
	return { user, ctx, project };
}

/**
 * Load the inputs the canonical `canView`/`canSolve` rules need, then call
 * the rule. The cross-org-public shortcut (allow-cross-org-public flag is on
 * AND visibility is public) returns early without any membership fetch.
 *
 * Permissions.md §5 — this is the single source of truth for view/solve
 * gating. Adapter `can*` methods on the project store also delegate to
 * `rules.ts`; the route layer used to inline its own predicate but now
 * funnels through the same rule.
 */
async function loadAndCheckView(ctx: RequestContext, project: Project): Promise<boolean> {
	const allowCrossOrgPublic = flag('ALLOW_CROSS_ORG_PUBLIC');
	// Cross-org public bypass: no membership fetch needed.
	if (project.visibility === 'public' && allowCrossOrgPublic) {
		return canView({
			platformPermissions: ctx.platformPermissions,
			orgPermissions: ctx.orgPermissions,
			project,
			member: null,
			orgMember: null,
			allowCrossOrgPublic
		});
	}
	// Private needs member, org/within-org-public needs orgMember. Fetch only
	// what the rule will consult.
	const [member, orgMember] = await Promise.all([
		project.visibility === 'private'
			? getProjectProvider().getProjectMember(ctx, project.id, ctx.userId)
			: Promise.resolve(null),
		project.visibility !== 'private'
			? getOrganizationProvider().getOrgMember(ctx, project.orgId, ctx.userId)
			: Promise.resolve(null)
	]);
	return canView({
		platformPermissions: ctx.platformPermissions,
		orgPermissions: ctx.orgPermissions,
		project,
		member,
		orgMember,
		allowCrossOrgPublic
	});
}

export async function requireCanViewProject(locals: Locals, projectId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId);
		return loadAndCheckView(ctx, project);
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return user;
}

/**
 * Solve gating. Today `canSolve === canView`, but the rule lives in its own
 * function so future cost-gating (quotas, rate limits) lands without touching
 * view semantics. `viewer` project role passes.
 */
export async function requireCanSolve(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);

	const allowed = await bypassOrRun(ctx, async () => {
		const allowCrossOrgPublic = flag('ALLOW_CROSS_ORG_PUBLIC');
		if (project.visibility === 'public' && allowCrossOrgPublic) {
			return canSolve({
				platformPermissions: ctx.platformPermissions,
				orgPermissions: ctx.orgPermissions,
				project,
				member: null,
				orgMember: null,
				allowCrossOrgPublic
			});
		}
		const [member, orgMember] = await Promise.all([
			project.visibility === 'private'
				? getProjectProvider().getProjectMember(ctx, project.id, ctx.userId)
				: Promise.resolve(null),
			project.visibility !== 'private'
				? getOrganizationProvider().getOrgMember(ctx, project.orgId, ctx.userId)
				: Promise.resolve(null)
		]);
		return canSolve({
			platformPermissions: ctx.platformPermissions,
			orgPermissions: ctx.orgPermissions,
			project,
			member,
			orgMember,
			allowCrossOrgPublic
		});
	});
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return { user, ctx, project };
}

/** Loads the record and gates editing. Returns the record so callers skip a re-fetch. */
export async function requireEditableDefinition(locals: Locals, guid: string) {
	const { ctx } = requireAuthed(locals);
	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record) throw error(404, 'Definition not found');
	const allowed = await bypassOrRun(ctx, async () => {
		const [project, member] = await Promise.all([
			getProjectProvider().getProject(ctx, record.projectId),
			getProjectProvider().getProjectMember(ctx, record.projectId, ctx.userId)
		]);
		return canEditDefinition({
			platformPermissions: ctx.platformPermissions,
			project,
			definition: record,
			member,
			userId: ctx.userId
		});
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return { record, ctx };
}

export async function requireCanEditDefinition(
	locals: Locals,
	projectId: string,
	definitionGuid: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await bypassOrRun(ctx, async () => {
		const [project, definition, member] = await Promise.all([
			getProjectProvider().getProject(ctx, projectId),
			getDefinitionMeta().get(ctx, definitionGuid),
			getProjectProvider().getProjectMember(ctx, projectId, ctx.userId)
		]);
		return canEditDefinition({
			platformPermissions: ctx.platformPermissions,
			project,
			definition,
			member,
			userId: ctx.userId
		});
	});
	if (!allowed) throw error(403, 'You do not have permission to edit this definition.');
	return user;
}
