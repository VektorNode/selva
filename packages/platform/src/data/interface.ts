import type { Organization, OrgMember } from '../organizations/types.js';
import type { OrgRole, OrgPermission } from '../organizations/schemas.js';
import type { Project, ProjectMember } from '../projects/types.js';
import type { ProjectRole } from '../projects/schemas.js';
import type {
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionVersion
} from '../definitions/types.js';
import type { ComputeConfig } from '../computeServer/types.js';
import type { RequestContext } from '../context.js';
import type { ListOptions, DefinitionListOptions, Page } from '../pagination.js';
import type { IInviteStore } from '../invites/interface.js';
import type { ShareLink } from '../shareLinks/types.js';

/**
 * Auth boundary contract for every store below.
 *
 * Every method takes a `RequestContext` first. **The query itself is the
 * security boundary** — adapters MUST scope reads/writes by `ctx`. An
 * unauthorized caller sees an empty page, `null`, or a `ProviderError`.
 *
 * Access-control predicates live in `@selvajs/platform/access` (pure rules).
 * Stores do storage; rules do rules. The route layer composes both: load
 * the entities the rule needs, then call the rule. See `access.server.ts`
 * in the compute-app for the canonical pattern.
 */
export interface IOrgStore {
	// Organizations
	listOrgs(ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>>;
	getOrg(ctx: RequestContext, id: string): Promise<Organization | null>;
	getOrgBySlug(ctx: RequestContext, slug: string): Promise<Organization | null>;
	createOrg(ctx: RequestContext, org: Organization): Promise<void>;
	updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug'>>
	): Promise<void>;
	/**
	 * Soft-delete the org. Cascades soft-delete to org members, projects in the
	 * org, and project members. Definitions and share links cascade through the
	 * project deletion. Invites and the org compute-server override are NOT
	 * cascaded — clean those up explicitly if needed.
	 */
	deleteOrg(ctx: RequestContext, id: string): Promise<void>;

	// Org members
	listOrgMembers(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<OrgMember>>;
	getOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<OrgMember | null>;
	/**
	 * Find ONE org membership for the user. Used by the request-bootstrap
	 * path to resolve `actingOrgId` without N+1-ing over `listOrgs`.
	 *
	 * Returns `null` when the user has no live membership. When the user has
	 * multiple memberships (multi-tenant deployments), the choice between
	 * them is adapter-defined — single-tenant deployments have exactly one,
	 * and multi-tenant deployments will eventually use a URL prefix
	 * (`/o/{slug}/...`) to pick explicitly. Soft-deleted memberships are
	 * excluded.
	 *
	 * Both `org` and `member` are scoped by `ctx` (RLS-aware on Supabase).
	 */
	findUserMembership(
		ctx: RequestContext,
		userId: string
	): Promise<{ org: Organization; member: OrgMember } | null>;
	addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void>;
	updateOrgMemberRole(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void>;
	/**
	 * Replace `OrgPermission` set without changing role. Use this for
	 * permission edits — round-tripping through remove + add cascades the
	 * org-removal soft-delete into project memberships.
	 */
	updateOrgMemberPermissions(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		permissions: readonly OrgPermission[]
	): Promise<void>;
	removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void>;
}

export interface IProjectStore {
	// Projects
	listProjects(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Project>>;
	getProject(ctx: RequestContext, id: string): Promise<Project | null>;
	getProjectBySlug(ctx: RequestContext, orgId: string, slug: string): Promise<Project | null>;
	createProject(ctx: RequestContext, project: Project): Promise<void>;
	updateProject(
		ctx: RequestContext,
		id: string,
		patch: Partial<
			Pick<Project, 'name' | 'slug' | 'description' | 'visibility' | 'autoJoinOnUpload'>
		>
	): Promise<void>;
	/**
	 * Soft-delete the project. Cascades to project members and definitions.
	 * Definition versions and share links cascade through the definition delete.
	 */
	deleteProject(ctx: RequestContext, id: string): Promise<void>;

	// Project members
	listProjectMembers(
		ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<ProjectMember>>;
	getProjectMember(
		ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectMember | null>;
	addProjectMember(ctx: RequestContext, member: ProjectMember): Promise<void>;
	updateProjectMemberRole(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		role: ProjectRole
	): Promise<void>;
	removeProjectMember(ctx: RequestContext, projectId: string, userId: string): Promise<void>;
}

/**
 * Definition metadata + version store. Blob contents live in `IStorageProvider`;
 * this interface tracks the parent record plus immutable version rows and the
 * `live` / `draft` channel pointers.
 */
export interface IDefinitionStore {
	// Definitions
	list(ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>>;
	listByProject(
		ctx: RequestContext,
		projectId: string,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>>;
	/**
	 * List definitions whose parent project has `visibility === 'public'`.
	 * Pass `orgId` to restrict to one org; omit for cross-org listing within
	 * whatever tenant boundary the adapter already enforces.
	 */
	listPublic(
		ctx: RequestContext,
		opts?: DefinitionListOptions & { orgId?: string }
	): Promise<Page<DefinitionRecord>>;
	get(ctx: RequestContext, guid: string): Promise<DefinitionRecord | null>;
	create(ctx: RequestContext, record: DefinitionRecord): Promise<void>;
	update(ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void>;
	delete(ctx: RequestContext, guid: string): Promise<void>;

	/** Atomic +1 on the run counter. No-op if the record doesn't exist. */
	incrementRunCount(ctx: RequestContext, guid: string): Promise<void>;

	// Versions (immutable rows)
	createVersion(ctx: RequestContext, version: DefinitionVersion): Promise<void>;
	/** Newest first by `versionNumber`. */
	listVersions(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<DefinitionVersion>>;
	getVersion(ctx: RequestContext, versionId: string): Promise<DefinitionVersion | null>;
	/**
	 * Throws 409 if the version is referenced by `liveVersionId` or
	 * `draftVersionId`. Caller deletes the blob separately.
	 */
	deleteVersion(ctx: RequestContext, versionId: string): Promise<void>;

	/** Atomically point `liveVersionId` at a target version of this definition. */
	setLiveVersion(ctx: RequestContext, definitionId: string, versionId: string): Promise<void>;
	setDraftVersion(ctx: RequestContext, definitionId: string, versionId: string): Promise<void>;

	/**
	 * Atomic `'pending'` → `'draft'` bootstrap. Sets BOTH `liveVersionId` and
	 * `draftVersionId` to `versionId` and flips `status` to `'draft'` in a
	 * single update — used by the create flow so a mid-flight failure can't
	 * leave the record half-promoted (status='draft' with a null channel
	 * pointer, or status='pending' with channels set).
	 *
	 * Validates that `versionId` belongs to `definitionId` (404 if not).
	 *
	 * Does NOT emit `definition.published`. The bootstrap is covered by the
	 * parent's `definition.created` + `definition_version.created` pair;
	 * `definition.published` is reserved for explicit publish ops via
	 * `setLiveVersion`.
	 */
	attachInitialVersion(
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void>;
}

/**
 * Compute-server configuration. Scope is determined by `ctx.actingOrgId`:
 * unset → instance pool (admin only); set → that org's override (gated by
 * the `ALLOW_ORG_COMPUTE_OVERRIDE` platform flag at the route layer).
 */
export interface IComputeServerStore {
	getConfig(ctx: RequestContext): Promise<ComputeConfig>;
	saveConfig(ctx: RequestContext, config: ComputeConfig): Promise<void>;
	/**
	 * Hard-delete this org's compute override rows (servers + defaults). No-op
	 * when none exist. Called from `deleteOrg` so soft-deleting an org does
	 * not leave its operational config behind.
	 */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;
}

/**
 * Per-definition tokens granting unauthenticated access to one
 * (definitionId, channel). The store sees only the HMAC hash; the raw token
 * is generated and shown to the minter at the route layer.
 *
 * Reads filter `revokedAt IS NULL` defensively.
 */
export interface IShareLinkStore {
	/** Insert a new link. Caller has already hashed the raw token. */
	create(ctx: RequestContext, link: ShareLink): Promise<void>;
	/** Newest first by `createdAt`. Excludes revoked links. */
	listByDefinition(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<ShareLink>>;
	getById(ctx: RequestContext, id: string): Promise<ShareLink | null>;
	/**
	 * Lookup by HMAC hash. Returns null when the link doesn't exist OR is
	 * revoked OR its parent definition is soft-deleted.
	 */
	getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<ShareLink | null>;
	/** Soft-delete (set `revokedAt`). Idempotent. */
	revoke(ctx: RequestContext, id: string): Promise<void>;
	/**
	 * Atomic check-and-increment. Returns the new `solveCount`, or null when
	 * the cap was reached. MUST be a single statement — read-then-write races
	 * under load. `null` maxSolves means uncapped.
	 */
	tryIncrementSolveCount(ctx: RequestContext, id: string): Promise<number | null>;
}

export interface IDataProvider {
	orgs: IOrgStore;
	projects: IProjectStore;
	definitions: IDefinitionStore;
	computeServer: IComputeServerStore;
	invites: IInviteStore;
	shareLinks: IShareLinkStore;
}
