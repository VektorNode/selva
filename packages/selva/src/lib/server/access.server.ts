import { error, redirect } from '@sveltejs/kit';
import type {
	AuthUser,
	OrgPermission,
	PlatformPermission,
	Project,
	ProjectAccessInput,
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
import {
	getProjectProvider,
	getDefinitionMeta,
	getOrganizationProvider,
	getPlatformProjectGrantStore,
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
 * NOT used for content access (view, solve, edit definitions). See §2 of
 * Permissions.md: `instance_admin` follows the same `canView`/`canEdit` rules
 * as any other user for content — keeping blast radius small and ensuring
 * any content escalation goes through Reclaim, leaving an audit trail.
 */
async function managementBypassOrRun(
	ctx: RequestContext,
	check: () => Promise<boolean>
): Promise<boolean> {
	if (hasPermission(ctx, 'instance_admin')) return true;
	return await check();
}

/**
 * Content-scope check — NO `instance_admin` bypass. `canView`, `canSolve`,
 * `canEdit`, and `canEditDefinition` run as-is regardless of platform role.
 * If platform staff need to access content, they use Reclaim first.
 */
async function contentCheck(check: () => Promise<boolean>): Promise<boolean> {
	return await check();
}

async function loadProjectOr404(ctx: RequestContext, projectId: string): Promise<Project> {
	const project = await getProjectProvider().getProject(ctx, projectId);
	if (!project) throw error(404, 'Project not found');
	return project;
}

/**
 * Build the rule input for any project-scope rule. Fetches exactly the rows
 * the rule will consult based on `project.visibility`:
 *
 * - `platform` → grants
 * - `private`  → caller's project member row
 * - `org` / `public` → caller's project member row (for canEdit/canManage) and
 *   org member row (for canView). Cross-org public skips the org row.
 *
 * Other fields default to safe values; pass `overrides` for the rare callers
 * that already loaded a row (e.g. tests, batched listing pages).
 */
async function buildProjectAccessInput(
	ctx: RequestContext,
	project: Project,
	overrides: Partial<ProjectAccessInput> = {}
): Promise<ProjectAccessInput> {
	const allowCrossOrgPublic = flag('ALLOW_CROSS_ORG_PUBLIC');
	const enablePlatformProjects = flag('ENABLE_PLATFORM_PROJECTS');

	let member: ProjectAccessInput['member'] = null;
	let orgMember: ProjectAccessInput['orgMember'] = null;
	let platformGrants: ProjectAccessInput['platformGrants'] = [];

	if (project.visibility === 'platform') {
		// When the flag is off the rule short-circuits before reading grants —
		// skip the lookup to keep "feature disabled" cheap.
		if (enablePlatformProjects) {
			platformGrants = await getPlatformProjectGrantStore().listByProject(ctx, project.id);
		}
	} else if (project.visibility === 'private') {
		member = await getProjectProvider().getProjectMember(ctx, project.id, ctx.userId);
	} else {
		const skipOrgMember = project.visibility === 'public' && allowCrossOrgPublic;
		[member, orgMember] = await Promise.all([
			getProjectProvider().getProjectMember(ctx, project.id, ctx.userId),
			skipOrgMember
				? Promise.resolve(null)
				: getOrganizationProvider().getOrgMember(ctx, project.orgId, ctx.userId)
		]);
	}

	return {
		orgPermissions: ctx.orgPermissions,
		platformPermissions: ctx.platformPermissions,
		project,
		member,
		orgMember,
		allowCrossOrgPublic,
		enablePlatformProjects,
		platformGrants,
		actingOrgId: ctx.actingOrgId ?? null,
		userId: ctx.userId,
		...overrides
	};
}

/**
 * Build a `ProjectAccessInput` from caller-provided rows without any I/O.
 * Used by listing pages that have already batch-loaded membership for many
 * projects; the route layer's per-row predicate calls this instead of
 * `buildProjectAccessInput` to avoid an N+1 fetch.
 */
export function projectAccessInputFromRows(
	ctx: RequestContext,
	project: Project,
	rows: {
		member?: ProjectAccessInput['member'];
		orgMember?: ProjectAccessInput['orgMember'];
		platformGrants?: ProjectAccessInput['platformGrants'];
	}
): ProjectAccessInput {
	return {
		orgPermissions: ctx.orgPermissions,
		platformPermissions: ctx.platformPermissions,
		project,
		member: rows.member ?? null,
		orgMember: rows.orgMember ?? null,
		allowCrossOrgPublic: flag('ALLOW_CROSS_ORG_PUBLIC'),
		enablePlatformProjects: flag('ENABLE_PLATFORM_PROJECTS'),
		platformGrants: rows.platformGrants ?? [],
		actingOrgId: ctx.actingOrgId ?? null,
		userId: ctx.userId
	};
}

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
 * §5 `canCreateProject` — owner/admin always; member needs `manage_projects`.
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
 * passes. Platform projects narrow to grants with `canSolve=true`.
 */
export async function requireCanSolve(
	locals: Locals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId);
	const allowed = await contentCheck(async () =>
		canSolve(await buildProjectAccessInput(ctx, project))
	);
	if (!allowed) throw error(403, 'You do not have access to this project.');
	return { user, ctx, project };
}

/** Loads the record and gates editing. Returns the record so callers skip a re-fetch. */
export async function requireEditableDefinition(locals: Locals, guid: string) {
	const { ctx } = requireAuthed(locals);
	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record) throw error(404, 'Definition not found');
	const allowed = await contentCheck(async () => {
		const [project, member] = await Promise.all([
			getProjectProvider().getProject(ctx, record.projectId),
			getProjectProvider().getProjectMember(ctx, record.projectId, ctx.userId)
		]);
		return canEditDefinition({
			project,
			definition: record,
			member,
			userId: ctx.userId,
			platformPermissions: ctx.platformPermissions,
			enablePlatformProjects: flag('ENABLE_PLATFORM_PROJECTS')
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
	const allowed = await contentCheck(async () => {
		const [project, definition, member] = await Promise.all([
			getProjectProvider().getProject(ctx, projectId),
			getDefinitionMeta().get(ctx, definitionGuid),
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
