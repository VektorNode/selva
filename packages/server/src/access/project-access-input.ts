import type { Project, ProjectAccessInput, RequestContext } from '@selvajs/platform';

/**
 * Marshals an app's providers into the one input shape platform's pure access
 * rules (`canView`/`canEdit`/`canSolve`/`canManage`/…) read. What lives here is
 * **which rows each visibility needs**, so a consuming app doesn't reimplement
 * and mis-fetch it:
 *
 * - `platform` → grants (skipped entirely while the feature flag is off)
 * - `private`  → caller's project member row
 * - `org` / `public` → caller's project member row (for canEdit/canManage) and
 *   org member row (for canView). Cross-org public skips the org row.
 *
 * Row lookups are injected as functions so lazily-initialized providers work
 * unchanged, and flags are read per call so runtime flips behave like the app's
 * own `flag()` reads.
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
	 * Fetches exactly the rows the rule will consult, based on
	 * `project.visibility`. Other fields default to safe values; `overrides` is
	 * for the rare caller that already loaded a row (tests, batched listings).
	 */
	buildProjectAccessInput(
		ctx: RequestContext,
		project: Project,
		overrides?: Partial<ProjectAccessInput>
	): Promise<ProjectAccessInput>;
	/**
	 * Same input, from caller-provided rows and no I/O. A listing page that has
	 * batch-loaded membership calls this per row instead of
	 * `buildProjectAccessInput`, which would fetch N+1 times.
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
				// With the flag off every rule returns false before reading grants,
				// so the lookup would be wasted I/O.
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
