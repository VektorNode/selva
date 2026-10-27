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

import {
	SYSTEM_CONTEXT,
	canCreateDefinition,
	canEditDefinition,
	canView,
	outsideTokenOrg,
	scopeAllows
} from '@selvajs/platform';
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
import { projectAccessInputFromRowsWith } from '../access/index.js';
import type { SelvaDeps } from '../api/deps.js';

/** Upper bound on the org/project scan. Visibility needs the whole set. */
const SCAN_LIMIT = 200;

/**
 * The stores this module reads. Required at every call site.
 *
 * These used to fall back to a host's composition root, which welded this
 * tenancy boundary to one app's boot — anything importing it started the whole
 * application. Handlers pass `req.deps`; page loads pass their own equivalent.
 * That is what lets a second host on a different provider set reuse this
 * boundary instead of rebuilding it.
 */
export type VisibilityDeps = Pick<
	SelvaDeps,
	'orgs' | 'projects' | 'platformProjectGrants' | 'definitionMeta' | 'flag'
>;

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
	/** Grants per scanned `platform` project; absent for every other visibility. */
	grantsByProjectId: Map<string, PlatformProjectGrant[]>;
}

/**
 * Resolve the caller's accessible project set in a constant number of queries.
 * Platform grants are fetched only for `platform`-visibility projects —
 * `canView` short-circuits before reading them for every other visibility.
 */
export async function resolveAccessibleProjects(
	ctx: RequestContext,
	deps: VisibilityDeps
): Promise<AccessibleProjectSet> {
	const orgs = deps.orgs;
	const projectStore = deps.projects;
	const grantStore = deps.platformProjectGrants;

	const orgsPage = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: SCAN_LIMIT });
	// An API token sees its own org only, cross-org public projects included.
	const orgIds = orgsPage.items.map((o) => o.id).filter((id) => !outsideTokenOrg(ctx, id));

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
			? grantStore.listByProjects(SYSTEM_CONTEXT, platformProjectIds)
			: Promise.resolve(new Map<string, PlatformProjectGrant[]>())
	]);

	const projects = allProjects.filter((project) =>
		canView(
			projectAccessInputFromRowsWith({ deps }, ctx, project, {
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
		orgMemberByOrgId,
		grantsByProjectId
	};
}

/**
 * Whether the caller may create a definition in at least one project of
 * `orgId`, by the same rule `requireCanCreateDefinition` applies. Reads the
 * org's projects a page at a time and stops at the first that passes.
 */
export async function canCreateDefinitionInOrg(
	ctx: RequestContext,
	orgId: string,
	deps: VisibilityDeps
): Promise<boolean> {
	const orgMember =
		(await deps.orgs.getOrgMembersFor(SYSTEM_CONTEXT, [orgId], ctx.userId)).get(orgId) ?? null;
	let cursor: string | undefined;
	do {
		const page = await deps.projects.listProjects(SYSTEM_CONTEXT, orgId, {
			limit: SCAN_LIMIT,
			cursor
		});
		const platformIds = page.items.filter((p) => p.visibility === 'platform').map((p) => p.id);
		const [members, grants] = await Promise.all([
			deps.projects.getProjectMembersFor(
				SYSTEM_CONTEXT,
				page.items.map((p) => p.id),
				ctx.userId
			),
			platformIds.length
				? deps.platformProjectGrants.listByProjects(SYSTEM_CONTEXT, platformIds)
				: Promise.resolve(new Map<string, PlatformProjectGrant[]>())
		]);
		const allowed = page.items.some((project) =>
			canCreateDefinition(
				projectAccessInputFromRowsWith({ deps }, ctx, project, {
					member: members.get(project.id) ?? null,
					orgMember,
					platformGrants: grants.get(project.id) ?? []
				})
			)
		);
		if (allowed) return true;
		cursor = page.nextCursor;
	} while (cursor);
	return false;
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
	opts: DefinitionListOptions & { projectId?: string } = {},
	deps: VisibilityDeps
): Promise<ListVisibleDefinitionsResult> {
	const { projectId, ...listOpts } = opts;
	const { projects } = await resolveAccessibleProjects(ctx, deps);

	const scoped = projectId ? projects.filter((p) => p.id === projectId) : projects;
	// An empty id set matches nothing, which is what a caller with no visible
	// projects should get — not an unfiltered listing.
	const page = await deps.definitionMeta.list(ctx, {
		...listOpts,
		projectIds: scoped.map((p) => p.id)
	});

	return { items: page.items, nextCursor: page.nextCursor, projects: scoped };
}

/**
 * Editable definitions whose `sourceDocumentId` is `documentId`: the ones the
 * caller could upload a new version of, by {@link mayUploadToDefinition}.
 *
 * Commons projects are scanned too, since a caller owns their own uploads there
 * without edit rights on the project; rows they can't edit are dropped after
 * the query, so a page can come back short while `nextCursor` stays valid.
 */
export async function listEditableDefinitionsByDocument(
	ctx: RequestContext,
	documentId: string,
	opts: DefinitionListOptions & { projectId?: string },
	deps: VisibilityDeps
): Promise<Page<DefinitionRecord>> {
	const { projectId, ...listOpts } = opts;
	const set = await resolveAccessibleProjects(ctx, deps);
	const rowsFor = (project: Project) => ({
		member: set.memberByProjectId.get(project.id) ?? null,
		orgMember: set.orgMemberByOrgId.get(project.orgId) ?? null,
		platformGrants: set.grantsByProjectId.get(project.id) ?? []
	});
	const candidates = set.projects.filter(
		(p) =>
			(!projectId || p.id === projectId) &&
			canCreateDefinition(projectAccessInputFromRowsWith({ deps }, ctx, p, rowsFor(p)))
	);

	const page = await deps.definitionMeta.list(ctx, {
		...listOpts,
		sourceDocumentId: documentId,
		projectIds: candidates.map((p) => p.id)
	});
	const items = page.items.filter((record) => {
		const project = set.allById.get(record.projectId);
		return project
			? mayUploadToDefinition(ctx, { record, project, ...rowsFor(project) }, deps)
			: false;
	});
	return { items, nextCursor: page.nextCursor };
}

/** A visible definition and the caller's rows that decided it. */
export interface VisibleDefinition {
	record: DefinitionRecord;
	project: Project;
	member: ProjectMember | null;
	orgMember: OrgMember | null;
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
	guid: string,
	deps: VisibilityDeps
): Promise<DefinitionRecord | null> {
	return (await loadVisibleDefinition(ctx, guid, deps))?.record ?? null;
}

/** {@link getVisibleDefinition} with the rows it read, for a second rule over the same caller. */
export async function loadVisibleDefinition(
	ctx: RequestContext,
	guid: string,
	deps: VisibilityDeps
): Promise<VisibleDefinition | null> {
	const meta = deps.definitionMeta;
	const projectStore = deps.projects;

	const record = await meta.get(ctx, guid);
	if (!record) return null;

	const project = await projectStore.getProject(SYSTEM_CONTEXT, record.projectId);
	if (!project || outsideTokenOrg(ctx, project.orgId)) return null;

	const [orgMembers, projectMembers, grants] = await Promise.all([
		deps.orgs.getOrgMembersFor(SYSTEM_CONTEXT, [project.orgId], ctx.userId),
		projectStore.getProjectMembersFor(SYSTEM_CONTEXT, [project.id], ctx.userId),
		project.visibility === 'platform'
			? deps.platformProjectGrants.listByProject(SYSTEM_CONTEXT, project.id)
			: Promise.resolve([] as PlatformProjectGrant[])
	]);

	const member = projectMembers.get(project.id) ?? null;
	const orgMember = orgMembers.get(project.orgId) ?? null;
	const allowed = canView(
		projectAccessInputFromRowsWith({ deps }, ctx, project, {
			member,
			orgMember,
			platformGrants: grants
		})
	);
	return allowed ? { record, project, member, orgMember } : null;
}

/**
 * May the caller upload a version of this definition and make one live? The
 * rule `requireEditableDefinition` applies, and for an API token its `upload`
 * scope on the definition, which is what those routes check.
 */
export function mayUploadToDefinition(
	ctx: RequestContext,
	{ record, project, member, orgMember }: VisibleDefinition,
	deps: Pick<VisibilityDeps, 'flag'>
): boolean {
	return (
		scopeAllows(ctx, 'upload', { definitionId: record.guid, projectId: project.id }) &&
		canEditDefinition({
			project,
			definition: record,
			member,
			orgMember,
			userId: ctx.userId,
			platformPermissions: ctx.platformPermissions,
			enablePlatformProjects: deps.flag('ENABLE_PLATFORM_PROJECTS')
		})
	);
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
	versionId: string,
	deps: VisibilityDeps
): Promise<DefinitionVersion | null> {
	const record = await getVisibleDefinition(ctx, guid, deps);
	if (!record) return null;

	const version = await deps.definitionMeta.getVersion(ctx, versionId);
	if (!version || version.definitionId !== record.guid) return null;
	return version;
}
