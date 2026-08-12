/**
 * Visibility-filtered definition reads, shared by the library page load and
 * `GET /api/v1/definitions`.
 *
 * **This is a tenancy boundary.** The project scan runs as `SYSTEM_CONTEXT` so
 * cross-org `public` projects are reachable when `ALLOW_CROSS_ORG_PUBLIC` is on;
 * `canView` over the fetched membership rows is the only thing keeping another
 * org's projects out of the result. The definition list itself is then filtered
 * *in the query* via `projectIds`, so the cursor is applied after visibility
 * rather than over a page that gets thinned afterwards.
 *
 * Cost is constant in the number of orgs and projects: three bulk membership
 * reads regardless of N. Anything added here must keep that property — a
 * per-project `await` inside a loop reintroduces the N+1 this replaced.
 */

import { SYSTEM_CONTEXT, canView } from '@selvajs/platform';
import type {
	DefinitionListOptions,
	DefinitionRecord,
	DefinitionVersion,
	OrgMember,
	Page,
	PlatformProjectGrant,
	Project,
	ProjectMember,
	RequestContext
} from '@selvajs/platform';
import {
	getDefinitionMeta,
	getOrganizationProvider,
	getProjectProvider,
	getPlatformProjectGrantStore
} from '$lib/server/providers.server';
import { projectAccessInputFromRows } from '$lib/server/access.server';

/** Upper bound on the org/project scan. Visibility needs the whole set. */
const SCAN_LIMIT = 200;

/**
 * The caller's accessible project set plus the membership rows it was derived
 * from, so a caller needing a second rule (`canEdit` on the projects page)
 * can evaluate it with no further I/O.
 */
export interface AccessibleProjectSet {
	projects: Project[];
	/** Every project the scan saw, keyed by id — for name lookups on rows. */
	allById: Map<string, Project>;
	/** The caller's project-membership row per scanned project (`null` = not a member). */
	memberByProjectId: Map<string, ProjectMember | null>;
	/** The caller's org-membership row per scanned org (`null` = not a member). */
	orgMemberByOrgId: Map<string, OrgMember | null>;
}

/**
 * Resolve the caller's accessible project set in a constant number of queries.
 * Platform grants are fetched only for `platform`-visibility projects —
 * `canView` short-circuits before reading them for every other visibility.
 */
export async function resolveAccessibleProjects(
	ctx: RequestContext
): Promise<AccessibleProjectSet> {
	const orgs = getOrganizationProvider();
	const projectStore = getProjectProvider();

	const orgsPage = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: SCAN_LIMIT });
	const orgIds = orgsPage.items.map((o) => o.id);

	const projectPages = await Promise.all(
		orgIds.map((orgId) => projectStore.listProjects(SYSTEM_CONTEXT, orgId, { limit: SCAN_LIMIT }))
	);
	const allProjects = projectPages.flatMap((p) => p.items);
	const projectIds = allProjects.map((p) => p.id);
	const platformProjectIds = allProjects
		.filter((p) => p.visibility === 'platform')
		.map((p) => p.id);

	const [orgMemberByOrgId, memberByProjectId, grantsByProjectId] = await Promise.all([
		orgs.getOrgMembersFor(SYSTEM_CONTEXT, orgIds, ctx.userId),
		projectStore.getProjectMembersFor(SYSTEM_CONTEXT, projectIds, ctx.userId),
		platformProjectIds.length
			? getPlatformProjectGrantStore().listByProjects(SYSTEM_CONTEXT, platformProjectIds)
			: Promise.resolve(new Map<string, PlatformProjectGrant[]>())
	]);

	const projects = allProjects.filter((project) =>
		canView(
			projectAccessInputFromRows(ctx, project, {
				member: memberByProjectId.get(project.id) ?? null,
				orgMember: orgMemberByOrgId.get(project.orgId) ?? null,
				platformGrants: grantsByProjectId.get(project.id) ?? []
			})
		)
	);

	return {
		projects,
		allById: new Map(allProjects.map((p) => [p.id, p])),
		memberByProjectId,
		orgMemberByOrgId
	};
}

export interface ListVisibleDefinitionsResult extends Page<DefinitionRecord> {
	/** For resolving a definition's `projectId` to a name. */
	projects: Project[];
}

/**
 * `opts.projectId` narrows to one project; a caller who cannot view it gets an
 * empty page rather than a 403, so this never reveals that a project exists.
 */
export async function listVisibleDefinitions(
	ctx: RequestContext,
	opts: DefinitionListOptions & { projectId?: string } = {}
): Promise<ListVisibleDefinitionsResult> {
	const { projectId, ...listOpts } = opts;
	const { projects } = await resolveAccessibleProjects(ctx);

	const scoped = projectId ? projects.filter((p) => p.id === projectId) : projects;
	// An empty id set matches nothing, which is what a caller with no visible
	// projects should get — not an unfiltered listing.
	const page = await getDefinitionMeta().list(ctx, {
		...listOpts,
		projectIds: scoped.map((p) => p.id)
	});

	return { items: page.items, nextCursor: page.nextCursor, projects: scoped };
}

/**
 * One definition, or `null` when the caller cannot view its project.
 *
 * Returns `null` rather than throwing 403 so callers surface a 404: a public
 * API that answers "forbidden" for a guid the caller cannot see turns
 * `/definitions/{guid}` into a cross-tenant existence oracle.
 */
export async function getVisibleDefinition(
	ctx: RequestContext,
	guid: string
): Promise<DefinitionRecord | null> {
	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record) return null;

	const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, record.projectId);
	if (!project) return null;

	const [orgMembers, projectMembers, grants] = await Promise.all([
		getOrganizationProvider().getOrgMembersFor(SYSTEM_CONTEXT, [project.orgId], ctx.userId),
		getProjectProvider().getProjectMembersFor(SYSTEM_CONTEXT, [project.id], ctx.userId),
		project.visibility === 'platform'
			? getPlatformProjectGrantStore().listByProject(SYSTEM_CONTEXT, project.id)
			: Promise.resolve([] as PlatformProjectGrant[])
	]);

	const allowed = canView(
		projectAccessInputFromRows(ctx, project, {
			member: projectMembers.get(project.id) ?? null,
			orgMember: orgMembers.get(project.orgId) ?? null,
			platformGrants: grants
		})
	);
	return allowed ? record : null;
}

/**
 * One version of a definition the caller can view, including its cached
 * `schema`. `null` when the definition is invisible, the version is missing, or
 * the version belongs to a different definition — a caller must not be able to
 * read an arbitrary version by pairing it with a guid they can see.
 */
export async function loadVisibleVersion(
	ctx: RequestContext,
	guid: string,
	versionId: string
): Promise<DefinitionVersion | null> {
	const record = await getVisibleDefinition(ctx, guid);
	if (!record) return null;

	const version = await getDefinitionMeta().getVersion(ctx, versionId);
	if (!version || version.definitionId !== record.guid) return null;
	return version;
}
