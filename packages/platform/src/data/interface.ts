import type { Organization, OrgMember } from '../organizations/types.js';
import type { OrgRole } from '../organizations/schemas.js';
import type { Project, ProjectMember } from '../projects/types.js';
import type { ProjectRole } from '../projects/schemas.js';
import type {
	DefinitionRecord,
	DefinitionRecordPatch,
	HistoryEntry
} from '../definitions/types.js';
import type { ComputeConfig } from '../computeServer/types.js';
import type { RequestContext } from '../context.js';
import type { ListOptions, DefinitionListOptions, Page } from '../pagination.js';
import type { IInviteStore } from '../invites/interface.js';

/**
 * ## Auth boundary contract (applies to IOrgStore and IProjectStore)
 *
 * Every method takes a RequestContext as its first argument. **The query
 * itself is the security boundary** — adapters MUST scope reads and writes
 * by `ctx` so that an unauthorized caller receives either an empty result
 * or a ProviderError (403/404). Never rely on callers to check permissions
 * before querying.
 *
 * The `can*` helpers on IProjectStore are a **UI convenience only**, used to
 * gate affordances ("show the Edit button?"). They are NOT a prerequisite for
 * calling the mutating methods — a well-behaved adapter must remain safe
 * even if a caller skips `canEdit` and calls `updateProject` directly.
 *
 * Rationale: SQL adapters using row-level security (Supabase, Postgres RLS)
 * enforce auth inside the query. Forcing a pre-flight `can*` check in every
 * route would double the round-trips for no security benefit. Adapters that
 * lack RLS (e.g. the local JSON adapter) must replicate the same effect in
 * application code.
 */
export interface IOrgStore {
	// ============================================================================
	// Organizations
	// ============================================================================
	listOrgs(ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>>;
	getOrg(ctx: RequestContext, id: string): Promise<Organization | null>;
	getOrgBySlug(ctx: RequestContext, slug: string): Promise<Organization | null>;
	createOrg(ctx: RequestContext, org: Organization): Promise<void>;
	updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug'>>
	): Promise<void>;
	deleteOrg(ctx: RequestContext, id: string): Promise<void>;

	// ============================================================================
	// Org members
	// ============================================================================
	listOrgMembers(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<OrgMember>>;
	getOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<OrgMember | null>;
	addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void>;
	updateOrgMemberRole(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void>;
	removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void>;
}

export interface IProjectStore {
	// ============================================================================
	// Projects
	// ============================================================================
	listProjects(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Project>>;
	getProject(ctx: RequestContext, id: string): Promise<Project | null>;
	getProjectBySlug(ctx: RequestContext, orgId: string, slug: string): Promise<Project | null>;
	createProject(ctx: RequestContext, project: Project): Promise<void>;
	updateProject(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Project, 'name' | 'slug' | 'description' | 'visibility'>>
	): Promise<void>;
	deleteProject(ctx: RequestContext, id: string): Promise<void>;

	// ============================================================================
	// Project members
	// ============================================================================
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

	// ============================================================================
	// Access checks (UI gating — NOT the security boundary)
	// ============================================================================
	// These answer "should the UI show this affordance?" — a single role lookup
	// or, in SQL, a single `select has_permission(...)` call. The mutating
	// methods above enforce the same rule independently; these helpers are never
	// a prerequisite for calling them.
	canEdit(ctx: RequestContext, projectId: string): Promise<boolean>;
	canEditProjectSettings(ctx: RequestContext, projectId: string): Promise<boolean>;
	canManage(ctx: RequestContext, projectId: string): Promise<boolean>;
}

/**
 * Definition metadata record store. Blob contents live in IStorageProvider;
 * this interface only handles the structured record + history entries.
 */
export interface IDefinitionStore {
	list(ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>>;
	listByProject(
		ctx: RequestContext,
		projectId: string,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>>;
	/**
	 * List definitions whose parent project has `visibility === 'public'`.
	 *
	 * Scope:
	 * - When `orgId` is provided, restrict to public projects in that org.
	 * - When `orgId` is omitted, list public projects across every org on
	 *   the instance. Adapters with tenant isolation (RLS) MUST still apply
	 *   whatever cross-org rules they enforce — `public` means "publicly
	 *   visible within the tenant boundary the query already respects",
	 *   not "bypass all auth."
	 *
	 * Filtering by definition `status` uses `opts.statuses` as usual;
	 * `includePending` still hides `pending` records by default.
	 */
	listPublic(
		ctx: RequestContext,
		opts?: DefinitionListOptions & { orgId?: string }
	): Promise<Page<DefinitionRecord>>;
	get(ctx: RequestContext, guid: string): Promise<DefinitionRecord | null>;
	create(ctx: RequestContext, record: DefinitionRecord): Promise<void>;
	update(ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void>;
	addHistoryEntry(ctx: RequestContext, guid: string, entry: HistoryEntry): Promise<void>;
	removeHistoryEntry(ctx: RequestContext, guid: string, ref: string): Promise<void>;
	delete(ctx: RequestContext, guid: string): Promise<void>;

	/**
	 * Atomically increment the run counter for a definition.
	 * Called after each successful solve. No-op if the record doesn't exist.
	 */
	incrementRunCount(ctx: RequestContext, guid: string): Promise<void>;

	/**
	 * Return records stuck in status='pending' older than the given ISO timestamp.
	 * Used by the janitor to GC records whose blob upload failed mid-flight.
	 * System-context only — never exposed to end users.
	 */
	listStalePending(ctx: RequestContext, olderThanIso: string): Promise<DefinitionRecord[]>;

	// ============================================================================
	// Access checks (UI gating — NOT the security boundary)
	// ============================================================================
	canEditDefinition(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		definitionOwnerId: string
	): Promise<boolean>;
}

/**
 * Compute-server configuration store.
 *
 * Currently global in the local provider. Once Supabase + multi-tenant Entra
 * land, "platform admin" becomes per-org and the adapter will need `ctx`
 * to authorize writes; passing it now means consumers don't have to be
 * touched again at that point.
 */
export interface IComputeServerStore {
	getConfig(ctx: RequestContext): Promise<ComputeConfig>;
	saveConfig(ctx: RequestContext, config: ComputeConfig): Promise<void>;
}

/**
 * Aggregate data provider — a composition of the four stores above.
 * Adapters typically implement one class per store and compose them here.
 */
export interface IDataProvider {
	orgs: IOrgStore;
	projects: IProjectStore;
	definitions: IDefinitionStore;
	computeServer: IComputeServerStore;
	invites: IInviteStore;
}
