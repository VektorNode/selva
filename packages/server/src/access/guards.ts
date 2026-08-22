/**
 * The permission guards every API handler runs before touching a store.
 *
 * These name no framework. A guard raises `ApiError`, which `runHandler` folds
 * into the response envelope — so the same guard protects a SvelteKit route, a
 * Next route handler, or a Hono route behind that host's own adapter.
 *
 * **Guards that redirect stay with the host.** A redirect is a browser-page
 * concept, not an API one, and a framework implements it by throwing a value
 * only that framework understands.
 *
 * A caller outside an API route — a page load, or a route that builds its own
 * `Response` — has to convert the `ApiError` at its boundary, since a framework
 * will not recognize it. Selva does that with `asHttpError` in
 * `access.server.ts`; SvelteKit gives anything that is not its own `HttpError` a
 * 500, so an unconverted guard denial reads as a crash.
 *
 * Providers arrive through {@link AccessDeps} rather than being resolved here.
 * That is what keeps this module importable without booting an app: a guard
 * that reached for a module global would drag the whole composition root — and
 * its top-level `await createSelvaProviders()` — into every consumer.
 */

import type {
	AuthUser,
	DefinitionRecord,
	OrgMember,
	OrgPermission,
	OrgRole,
	PlatformPermission,
	Project,
	RequestContext,
	SelvaConfig
} from '@selvajs/platform';
import {
	isFlagEnabled,
	hasPermission,
	canReclaim,
	canCreateProject,
	canChangeOrgRole,
	canView,
	canSolve,
	canEdit,
	canManage,
	canEditProjectSettings,
	canEditDefinition
} from '@selvajs/platform';
import {
	createProjectAccessInputBuilder,
	type ProjectAccessInputBuilder
} from './project-access-input.js';
import { apiError, ApiErrorCode } from '../api/errors.js';
import type { SelvaDeps } from '../api/deps.js';

export type AnyPermission = PlatformPermission | OrgPermission;

/**
 * What the permission-only guards read.
 *
 * `deps` is absent here on purpose: `requirePermission` and friends check
 * `ctx.platformPermissions` and touch no store, so demanding providers from
 * their callers — the ~20 admin routes and page loads that only ever ask "may
 * this user do X?" — would be a cost with nothing behind it. The guards that do
 * read stores take `HasDeps` instead, which requires them.
 */
export interface Locals {
	user?: AuthUser;
	ctx?: RequestContext;
}

/**
 * What a store-reading guard takes: identity plus the providers to read with.
 *
 * `ApiRequest` satisfies this structurally, so a mounted handler passes itself.
 * Everyone else passes `scoped(locals)`.
 */
type ScopedLocals = Locals & HasDeps;

/**
 * The stores a guard reads, injected rather than resolved.
 *
 * `ApiRequest` satisfies this structurally, so a mounted handler passes itself
 * and the guard runs against that request's providers.
 *
 * **Required, not optional.** These guards used to fall back to a host's module
 * globals when no `deps` arrived, which meant importing this file pulled in that
 * host's composition root — in Selva a module running a top-level
 * `await createSelvaProviders()`, so any handler importing a guard booted the
 * whole provider stack. That is what kept these guards in the app; a caller with
 * no `deps` in hand builds them with `accessDepsFromConfig`.
 */
export type AccessDeps = Pick<
	SelvaDeps,
	'orgs' | 'projects' | 'definitionMeta' | 'platformProjectGrants' | 'flag'
>;

interface HasDeps {
	deps: AccessDeps;
}

/**
 * Derive the stores a guard needs from a resolved config.
 *
 * Pure — it reads the config it is handed and nothing else, which is what keeps
 * this module free of any import that boots the app. Page loads pass
 * `locals.providers`; `hooks.server.ts` sets it on every request.
 */
export function accessDepsFromConfig(config: SelvaConfig): AccessDeps {
	return {
		orgs: config.data.orgs,
		projects: config.data.projects,
		definitionMeta: config.data.definitions,
		platformProjectGrants: config.data.platformProjectGrants,
		flag: (name) => isFlagEnabled(config, name)
	};
}

/** `locals` as a store-reading guard wants it. */
export function scoped<L extends Locals & { providers: SelvaConfig }>(
	locals: L
): L & { deps: AccessDeps } {
	return { ...locals, deps: accessDepsFromConfig(locals.providers) };
}

// Accessors rather than `src.deps.orgs` inline: they keep the 17 call sites
// below reading the same as before, and they are the single place that would
// change if `AccessDeps` grew a store.
const orgsOf = (src: HasDeps) => src.deps.orgs;
const projectsOf = (src: HasDeps) => src.deps.projects;
const definitionMetaOf = (src: HasDeps) => src.deps.definitionMeta;
const flagOf = (src: HasDeps) => src.deps.flag;

export function requireAuthed(locals: Locals): { user: AuthUser; ctx: RequestContext } {
	const { user, ctx } = locals;
	if (!user || !ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	return { user, ctx };
}

/** Throws 403 — use in API routes. */
export function requirePermission(locals: Locals, permission: AnyPermission): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(ctx, permission)) {
		apiError(403, ApiErrorCode.FORBIDDEN, `You don't have permission to do this.`);
	}
	return user;
}

// Named aliases exist only for permissions with real call sites. Routes gating
// on anything else call `requirePermission(locals, '…')` directly rather than
// growing an alias per permission — `manage_definitions` and `manage_projects`
// had wrappers that nothing ever called.
export const requireManageInstanceUsers = (locals: Locals) =>
	requirePermission(locals, 'manage_instance_users');
export const requireManageCompute = (locals: Locals) => requirePermission(locals, 'manage_compute');
export const requireManageOrgMembers = (locals: Locals) =>
	requirePermission(locals, 'manage_org_members');
export const requireManageOrgCompute = (locals: Locals) =>
	requirePermission(locals, 'manage_org_compute');

export const requireInstanceAdmin = (locals: Locals) => requirePermission(locals, 'instance_admin');

/**
 * Platform scope is not delegable: `manage_instance_users` runs the user-admin
 * surface but must not be able to mint an `instance_admin`, or an org admin
 * holding it self-elevates. Three routes write platform permissions — the two
 * `/api/admin/users` handlers and the invite mint route — and each carried its
 * own copy of this check.
 *
 * Pass `current` on an update. Revoking is a platform-scope change too, so a
 * PATCH that drops `instance_admin` is refused for the same reason granting it
 * is; without `current` the caller is creating (a user, an invite) and there is
 * nothing to compare against.
 *
 * Requesting nothing on a create is always allowed — that is a
 * `manage_instance_users` operation, not a platform-scope one.
 */
export function assertCanGrantPlatformPermissions(
	ctx: RequestContext,
	requested: readonly PlatformPermission[],
	current?: readonly PlatformPermission[]
): void {
	const changed = current
		? requested.length !== current.length ||
			requested.some((p) => !current.includes(p)) ||
			current.some((p) => !requested.includes(p))
		: requested.length > 0;
	if (!changed) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	apiError(
		403,
		ApiErrorCode.FORBIDDEN,
		current
			? 'Only a platform admin can change platform-scope permissions'
			: 'Only a platform admin can grant platform-scope permissions'
	);
}

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
 * Gate for pages reachable by any platform-class permission holder (the

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

async function loadProjectOr404(
	ctx: RequestContext,
	projectId: string,
	src: HasDeps
): Promise<Project> {
	const project = await projectsOf(src).getProject(ctx, projectId);
	if (!project) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');
	return project;
}

// Rule-input assembly (the "which rows does each visibility need" knowledge)
// lives in `@selvajs/server/access`; this binding wires it to the provider set
// the caller carries.
function accessInputsFor(src: HasDeps) {
	const readFlag = flagOf(src);
	return createProjectAccessInputBuilder({
		getProjectMember: (ctx, projectId, userId) =>
			projectsOf(src).getProjectMember(ctx, projectId, userId),
		getOrgMember: (ctx, orgId, userId) => orgsOf(src).getOrgMember(ctx, orgId, userId),
		listPlatformGrants: (ctx, projectId) =>
			src.deps.platformProjectGrants.listByProject(ctx, projectId),
		flags: () => ({
			allowCrossOrgPublic: readFlag('ALLOW_CROSS_ORG_PUBLIC'),
			enablePlatformProjects: readFlag('ENABLE_PLATFORM_PROJECTS')
		})
	});
}

function buildProjectAccessInput(
	ctx: RequestContext,
	project: Project,
	src: HasDeps,
	overrides?: Parameters<ProjectAccessInputBuilder['buildProjectAccessInput']>[2]
) {
	return accessInputsFor(src).buildProjectAccessInput(ctx, project, overrides);
}

/**
 * Assemble a rule input from rows the caller already loaded.
 *
 * Unlike the other builders this one issues no reads — the caller batched them.
 * It still needs `deps` for the flag lookups, which decide whether a
 * cross-org-public or platform project is visible at all.
 */
export function projectAccessInputFromRowsWith(
	src: HasDeps,
	...args: Parameters<ProjectAccessInputBuilder['projectAccessInputFromRows']>
) {
	return accessInputsFor(src).projectAccessInputFromRows(...args);
}

/**
 * Gates creation of a *new* definition. Container projects require project
 * owner/editor (canEdit). Commons projects (`autoJoinOnUpload=true`) accept
 * any authenticated user — the handler stamps `ownerId = user.id` so the
 * uploader becomes the owner.
 */
export async function requireCanCreateDefinition(
	locals: ScopedLocals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId, locals);
	const allowed = await contentCheck(async () => {
		if (project.autoJoinOnUpload) return true;
		return canEdit(await buildProjectAccessInput(ctx, project, locals));
	});
	if (!allowed) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'You do not have permission to upload definitions to this project.'
		);
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
export async function requireCanViewOrg(locals: ScopedLocals, orgId: string): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await contentCheck(async () => {
		const member = await orgsOf(locals).getOrgMember(ctx, orgId, ctx.userId);
		return member !== null;
	});
	if (!allowed)
		apiError(403, ApiErrorCode.FORBIDDEN, 'You do not have access to this organization.');
	return user;
}

/**
 * Project members must belong to the project's parent org. Enforced at the
 * rule layer, not as a DB constraint, to leave room for cross-org guests
 * later without a schema migration.
 */
export async function requireTargetIsOrgMember(
	locals: ScopedLocals,
	orgId: string,
	targetUserId: string
): Promise<void> {
	const { ctx } = requireAuthed(locals);
	const member = await orgsOf(locals).getOrgMember(ctx, orgId, targetUserId);
	if (!member) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			'User must be a member of this organization to be added to a project.'
		);
	}
}

/**
 * `canChangeOrgRole` with the actor's membership row loaded — whether the
 * caller may grant or revoke org `owner`/`admin` standing (§3).
 *
 * Returns rather than throws: the three callers each phrase the refusal for
 * what they were doing ("invite someone as owner", "change roles", "remove
 * another owner") and raise it through `apiError`. What must not diverge is the
 * decision, which is why that half lives in `rules.ts` and this loads its input.
 */
export async function canActorChangeOrgRole(
	ctx: RequestContext,
	orgId: string,
	role: OrgRole,
	src: HasDeps
): Promise<boolean> {
	if (role === 'member') return true;
	const actorMember = await orgsOf(src).getOrgMember(ctx, orgId, ctx.userId);
	return canChangeOrgRole({ actorMember, role });
}

/**
 * `canReclaim` — org owner/admin escape hatch. Returns the project so the
 * handler can use its `orgId` without re-fetching.
 */
export async function requireCanReclaim(
	locals: ScopedLocals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId, locals);

	// Ahead of the bypass, not inside the check: `instance_admin` short-circuits
	// `managementBypassOrRun`, so `canReclaim`'s platform-project refusal (§4a)
	// never ran for the one role that could reach it. Reclaim is content
	// escalation wearing management clothing — the management bypass is not its
	// to inherit.
	if (project.visibility === 'platform') {
		apiError(403, ApiErrorCode.FORBIDDEN, 'Platform projects cannot be reclaimed.');
	}

	const allowed = await managementBypassOrRun(ctx, async () => {
		const orgMember = await orgsOf(locals).getOrgMember(ctx, project.orgId, ctx.userId);
		return canReclaim({
			project,
			orgMember,
			actingOrgId: ctx.actingOrgId ?? null
		});
	});
	if (!allowed) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Only org owners or admins of this project’s org can reclaim it.'
		);
	}
	return { user, ctx, project };
}

/**
 * `canCreateProject` — owner/admin always; member needs `manage_projects`.
 * Tenancy is enforced via `actingOrgId`.
 */
export async function requireCanCreateProject(
	locals: ScopedLocals,
	targetOrgId: string
): Promise<{ user: AuthUser; ctx: RequestContext }> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await managementBypassOrRun(ctx, async () => {
		const orgMember = await orgsOf(locals).getOrgMember(ctx, targetOrgId, ctx.userId);
		return canCreateProject({
			orgPermissions: ctx.orgPermissions,
			orgMember,
			actingOrgId: ctx.actingOrgId ?? null,
			targetOrgId
		});
	});
	if (!allowed)
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'You do not have permission to create projects in this org.'
		);
	return { user, ctx };
}

/**
 * Project-management gate (`canManage` — owner, or `instance_admin` via the
 * bypass). Managing members is the same authority as managing the project, so
 * both callers share this; `action` only shapes the 403 message.
 */
export async function requireCanManage(
	locals: ScopedLocals,
	projectId: string,
	action: 'project' | 'members' = 'project'
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await managementBypassOrRun(ctx, async () => {
		const project = await loadProjectOr404(ctx, projectId, locals);
		return canManage(await buildProjectAccessInput(ctx, project, locals));
	});
	if (!allowed) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			action === 'members'
				? 'Only project owners can manage members.'
				: 'Only project owners can manage this project.'
		);
	}
	return user;
}

// Owner-only gate for project settings, centralized so PATCH
// /api/projects/[id] matches the rest of the access layer.
export async function requireCanEditProjectSettings(
	locals: ScopedLocals,
	projectId: string
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = await loadProjectOr404(ctx, projectId, locals);
	const allowed = await managementBypassOrRun(ctx, async () =>
		canEditProjectSettings(await buildProjectAccessInput(ctx, project, locals))
	);
	if (!allowed)
		apiError(403, ApiErrorCode.FORBIDDEN, 'Only project owners can edit project settings.');
	return { user, ctx, project };
}

export async function requireCanViewProject(
	locals: ScopedLocals,
	projectId: string
): Promise<AuthUser> {
	const { user, ctx } = requireAuthed(locals);
	const allowed = await contentCheck(async () => {
		const project = await loadProjectOr404(ctx, projectId, locals);
		return canView(await buildProjectAccessInput(ctx, project, locals));
	});
	if (!allowed) apiError(403, ApiErrorCode.FORBIDDEN, 'You do not have access to this project.');
	return user;
}

/**
 * Solve gating. Today `canSolve === canView` for non-platform projects, but
 * the rule lives in its own function so future cost-gating (quotas, rate
 * limits) lands without touching view semantics. `viewer` project role
 * passes; platform projects narrow to grants with `canSolve=true`.
 */
export async function requireCanSolve(
	locals: ScopedLocals,
	projectId: string,
	// Callers that already loaded the project (e.g. the solve endpoint, which
	// reads orgId/pin off it) pass it to skip a redundant `getProject` here.
	preloadedProject?: Project
): Promise<{ user: AuthUser; ctx: RequestContext; project: Project }> {
	const { user, ctx } = requireAuthed(locals);
	const project = preloadedProject ?? (await loadProjectOr404(ctx, projectId, locals));
	const allowed = await contentCheck(async () =>
		canSolve(await buildProjectAccessInput(ctx, project, locals))
	);
	if (!allowed) apiError(403, ApiErrorCode.FORBIDDEN, 'You do not have access to this project.');
	return { user, ctx, project };
}

/**
 * Org membership for the commons branch of `canEditDefinition`, or `null` when
 * that branch cannot fire. Skipping the round-trip on container projects keeps
 * the common edit path at the same two reads it had before commons gained the
 * membership test.
 */
async function loadCommonsOrgMember(
	ctx: RequestContext,
	project: Project | null,
	src: HasDeps
): Promise<OrgMember | null> {
	if (!project?.autoJoinOnUpload) return null;
	return await orgsOf(src).getOrgMember(ctx, project.orgId, ctx.userId);
}

/**
 * Loads the record and gates editing. Returns the record AND the project it
 * loads for the gate, so callers skip a re-fetch of either.
 */
export async function requireEditableDefinition(locals: ScopedLocals, guid: string) {
	const { ctx } = requireAuthed(locals);
	const record = await definitionMetaOf(locals).get(ctx, guid);
	if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
	// Load project + member once up front; `project` is returned for reuse.
	const [project, member] = await Promise.all([
		projectsOf(locals).getProject(ctx, record.projectId),
		projectsOf(locals).getProjectMember(ctx, record.projectId, ctx.userId)
	]);
	const allowed = await contentCheck(async () =>
		canEditDefinition({
			project,
			definition: record,
			member,
			orgMember: await loadCommonsOrgMember(ctx, project, locals),
			userId: ctx.userId,
			platformPermissions: ctx.platformPermissions,
			enablePlatformProjects: flagOf(locals)('ENABLE_PLATFORM_PROJECTS')
		})
	);
	if (!allowed)
		apiError(403, ApiErrorCode.FORBIDDEN, 'You do not have permission to edit this definition.');
	return { record, ctx, project };
}

export async function requireCanEditDefinition(
	locals: ScopedLocals,
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
				: projectsOf(locals).getProject(ctx, projectId),
			preloaded?.definition !== undefined
				? Promise.resolve(preloaded.definition)
				: definitionMetaOf(locals).get(ctx, definitionGuid),
			projectsOf(locals).getProjectMember(ctx, projectId, ctx.userId)
		]);
		return canEditDefinition({
			project,
			definition,
			member,
			orgMember: await loadCommonsOrgMember(ctx, project, locals),
			userId: ctx.userId,
			platformPermissions: ctx.platformPermissions,
			enablePlatformProjects: flagOf(locals)('ENABLE_PLATFORM_PROJECTS')
		});
	});
	if (!allowed)
		apiError(403, ApiErrorCode.FORBIDDEN, 'You do not have permission to edit this definition.');
	return user;
}
