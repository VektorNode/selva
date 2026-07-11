import type { Project, ProjectAccessInput, RequestContext } from '@selvajs/platform';

/**
 * Assembly of `ProjectAccessInput` — the marshalling layer between an app's
 * providers and platform's pure access rules (`canView`/`canEdit`/`canSolve`/
 * `canManage`/…). The rules are pure functions over one input shape; the
 * knowledge captured here is **which rows each project visibility needs**, so
 * a consuming app doesn't reimplement (and mis-fetch) it:
 *
 * - `platform` → grants (skipped entirely while the feature flag is off)
 * - `private`  → caller's project member row
 * - `org` / `public` → caller's project member row (for canEdit/canManage) and
 *   org member row (for canView). Cross-org public skips the org row.
 *
 * Wiring is injected: row lookups as functions (so lazily-initialized
 * providers work unchanged) and flags read per call (so runtime flag flips
 * behave like the app's own `flag()` reads).
 */

export interface ProjectAccessFlags {
	/** `ALLOW_CROSS_ORG_PUBLIC` — public visibility spans orgs when true. */
	allowCrossOrgPublic: boolean;
	/** `ENABLE_PLATFORM_PROJECTS` — platform visibility is live when true. */
	enablePlatformProjects: boolean;
}

export interface ProjectAccessInputDeps {
	getProjectMember(
		ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectAccessInput['member']>;
	getOrgMember(
		ctx: RequestContext,
		orgId: string,
		userId: string
	): Promise<ProjectAccessInput['orgMember']>;
	listPlatformGrants(
		ctx: RequestContext,
		projectId: string
	): Promise<ProjectAccessInput['platformGrants']>;
	/** Read the two access-relevant feature flags. Called once per assembly. */
	flags(): ProjectAccessFlags;
}

export interface ProjectAccessInputBuilder {
	/**
	 * Build the rule input for any project-scope rule, fetching exactly the
	 * rows the rule will consult based on `project.visibility`. Other fields
	 * default to safe values; pass `overrides` for the rare callers that
	 * already loaded a row (e.g. tests, batched listing pages).
	 */
	buildProjectAccessInput(
		ctx: RequestContext,
		project: Project,
		overrides?: Partial<ProjectAccessInput>
	): Promise<ProjectAccessInput>;
	/**
	 * Build a `ProjectAccessInput` from caller-provided rows without any I/O.
	 * Used by listing pages that have already batch-loaded membership for many
	 * projects; the per-row predicate calls this instead of
	 * `buildProjectAccessInput` to avoid an N+1 fetch.
	 */
	projectAccessInputFromRows(
		ctx: RequestContext,
		project: Project,
		rows: {
			member?: ProjectAccessInput['member'];
			orgMember?: ProjectAccessInput['orgMember'];
			platformGrants?: ProjectAccessInput['platformGrants'];
		}
	): ProjectAccessInput;
}

export function createProjectAccessInputBuilder(
	deps: ProjectAccessInputDeps
): ProjectAccessInputBuilder {
	return {
		async buildProjectAccessInput(
			ctx: RequestContext,
			project: Project,
			overrides: Partial<ProjectAccessInput> = {}
		): Promise<ProjectAccessInput> {
			const { allowCrossOrgPublic, enablePlatformProjects } = deps.flags();

			let member: ProjectAccessInput['member'] = null;
			let orgMember: ProjectAccessInput['orgMember'] = null;
			let platformGrants: ProjectAccessInput['platformGrants'] = [];

			if (project.visibility === 'platform') {
				// When the flag is off the rule short-circuits before reading grants —
				// skip the lookup to keep "feature disabled" cheap.
				if (enablePlatformProjects) {
					platformGrants = await deps.listPlatformGrants(ctx, project.id);
				}
			} else if (project.visibility === 'private') {
				member = await deps.getProjectMember(ctx, project.id, ctx.userId);
			} else {
				const skipOrgMember = project.visibility === 'public' && allowCrossOrgPublic;
				[member, orgMember] = await Promise.all([
					deps.getProjectMember(ctx, project.id, ctx.userId),
					skipOrgMember ? Promise.resolve(null) : deps.getOrgMember(ctx, project.orgId, ctx.userId)
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
		},

		projectAccessInputFromRows(
			ctx: RequestContext,
			project: Project,
			rows: {
				member?: ProjectAccessInput['member'];
				orgMember?: ProjectAccessInput['orgMember'];
				platformGrants?: ProjectAccessInput['platformGrants'];
			}
		): ProjectAccessInput {
			const { allowCrossOrgPublic, enablePlatformProjects } = deps.flags();
			return {
				orgPermissions: ctx.orgPermissions,
				platformPermissions: ctx.platformPermissions,
				project,
				member: rows.member ?? null,
				orgMember: rows.orgMember ?? null,
				allowCrossOrgPublic,
				enablePlatformProjects,
				platformGrants: rows.platformGrants ?? [],
				actingOrgId: ctx.actingOrgId ?? null,
				userId: ctx.userId
			};
		}
	};
}
