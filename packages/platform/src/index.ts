// @selvajs/platform — published API contract. Every symbol here is breaking-change-protected.

// auth
export type { AuthUser, UserManagementResult, LoginResult } from './auth/types.js';
export type {
	IAuthProvider,
	IOAuthAuth,
	ISessionRefresh,
	IPasswordAuth,
	IEmailLinkAuth,
	IProxyAuth
} from './auth/interface.js';

// ---------------------------------------------------------------------------
// permissions
// ---------------------------------------------------------------------------
export type { PlatformPermission } from './permissions/types.js';
export { PlatformPermissionSchema, ALL_PLATFORM_PERMISSIONS } from './permissions/types.js';
export type { IPlatformPermissionStore } from './permissions/interface.js';

// userProfile
export type { IUserProfileStore } from './userProfile/interface.js';
export type { UserProfile, RecentRun } from './userProfile/types.js';
export { emptyProfile } from './userProfile/types.js';

// organizations
export type { Organization, OrgMember, OrgAssets } from './organizations/types.js';
export type { IOrgStore } from './organizations/interface.js';
export { orgPaths } from './organizations/paths.js';
export type {
	OrgRole,
	OrgPermission,
	OrgAssetKind,
	CreateOrgInput,
	UpdateOrgInput
} from './organizations/schemas.js';
export {
	OrgRoleSchema,
	OrgPermissionSchema,
	OrgAssetKindSchema,
	ALL_ORG_ASSET_KINDS,
	SlugSchema,
	slugify,
	RESERVED_SLUGS,
	CreateOrgSchema,
	UpdateOrgSchema,
	ALL_ORG_PERMISSIONS,
	DEFAULT_ORG_PERMISSIONS,
	OWNER_ADMIN_ONLY_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS
} from './organizations/schemas.js';

// invites
export type { Invite } from './invites/types.js';
export type { IInviteStore } from './invites/interface.js';

// projects
export type { Project, ProjectMember } from './projects/types.js';
export type { IProjectStore } from './projects/interface.js';
export type { ProjectVisibility, ProjectRole } from './projects/schemas.js';
export {
	ProjectVisibilitySchema,
	ProjectRoleSchema,
	validateProjectFlags
} from './projects/schemas.js';

// platformProjects
export type { PlatformProjectGrant, PlatformProjectGranteeType } from './platformProjects/types.js';
export type { IPlatformProjectGrantStore } from './platformProjects/interface.js';
export {
	PlatformProjectGrantSchema,
	PlatformProjectGranteeTypeSchema
} from './platformProjects/schemas.js';

// definitions
export type {
	DefinitionFileExt,
	DefinitionListItem,
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionStatus,
	DefinitionVersion,
	DefinitionChannel
} from './definitions/types.js';
export type { IDefinitionStore } from './definitions/interface.js';
export type { UISchema } from '@selvajs/schemas';
export {
	GH_EXTENSIONS,
	COVER_IMAGE_EXTENSIONS,
	ALLOWED_UPLOAD_EXTENSIONS,
	COVER_IMAGE_CONTENT_TYPES,
	toDefinitionListItem
} from './definitions/types.js';
export { definitionPaths } from './definitions/paths.js';
export type { UpdateMetadataInput } from './definitions/schemas.js';
export {
	DefinitionChannelSchema,
	PublishVersionInputSchema,
	CreateDefinitionInputSchema,
	UpdateMetadataInputSchema,
	GuidSchema,
	UUID_REGEX
} from './definitions/schemas.js';

// ---------------------------------------------------------------------------
// shareLinks
// ---------------------------------------------------------------------------
export type { OrgShareLink, ShareLink } from './shareLinks/types.js';
export type { IShareLinkStore } from './shareLinks/interface.js';
export { DEFAULT_SHARE_LINK_MAX_SOLVES } from './shareLinks/types.js';
export type { CreateShareLinkInput } from './shareLinks/schemas.js';
export { CreateShareLinkInputSchema } from './shareLinks/schemas.js';

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
export type { IStorageProvider } from './storage/interface.js';
export {
	IMAGE_MAX_WIDTH,
	IMAGE_WEBP_QUALITY,
	isImageUpload,
	toWebpPath,
	transcodeImageIfNeeded
} from './storage/image.js';
export type { TranscodeResult } from './storage/image.js';
export { ASSET_CLASSES, classifyAssetPath, isPublicAssetPath } from './storage/assetClasses.js';
export type {
	AssetVisibility,
	AssetScope,
	AssetClass,
	AssetMatch
} from './storage/assetClasses.js';
export { withCacheBust } from './storage/cacheBust.js';

// ---------------------------------------------------------------------------
// data (composition root)
// ---------------------------------------------------------------------------
export type { IDataProvider, SchemaVersionReport, UserErasureOptions } from './data/interface.js';
export { ERASED_ACTOR_ID } from './data/interface.js';

// ---------------------------------------------------------------------------
// computeServer
// ---------------------------------------------------------------------------
export type {
	ComputeServerConfig,
	ComputeConfig,
	PlatformComputeServer,
	OrgComputeServer
} from './computeServer/types.js';
export { isPlatformServer, isOrgServer } from './computeServer/types.js';
export type { IComputeServerStore, GetConfigOptions } from './computeServer/interface.js';
// Secret crypto functions (encryptSecret etc.) use node:crypto and are NOT re-exported
// here — this barrel is imported by client .svelte code and a browser bundle can't
// resolve them. Import from '@selvajs/platform/computeServer' (server-only) instead.
// Report types are erased at build, so they stay here for convenience.
export type {
	SecretVerificationReport,
	SecretVerificationFailure,
	SecretVerificationFailureReason
} from './computeServer/secrets.js';
export type { ResolveOptions } from './computeServer/utils.js';
export {
	serversVisibleTo,
	defaultServerIdFor,
	resolveServerForOrg,
	findServerById,
	platformServers,
	orgServersFor,
	scopeConfigToOrg
} from './computeServer/utils.js';

// ---------------------------------------------------------------------------
// access (pure permission predicates)
// ---------------------------------------------------------------------------
export type {
	ProjectAccessInput,
	DefinitionAccessInput,
	VisibilityChangeInput,
	ReclaimAccessInput,
	CreateProjectAccessInput,
	OrgOwnerAuthorityInput,
	OwnerRemovalInput,
	OwnerRemovalCheck
} from './access/rules.js';
export {
	canView,
	canSolve,
	canEdit,
	canManage,
	canEditProjectSettings,
	canChangeVisibilityToPublic,
	canEditDefinition,
	canReclaim,
	canCreateProject,
	canChangeOrgRole,
	checkOwnerRemoval,
	withAdminBypass
} from './access/rules.js';

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------
export type { DomainEvent, DomainEventType, IEventSink } from './events/interface.js';
export { actorFrom, NoopEventSink, AUDIT_EVENT_VERSION } from './events/interface.js';
export type {
	AuditEventRow,
	AuditCursor,
	AuditQueryFilters,
	AuditQueryResult,
	IAuditQuery
} from './events/audit.js';

// ---------------------------------------------------------------------------
// metrics (per-solve timing telemetry)
// ---------------------------------------------------------------------------
export type { ISolveMetricSink, SolveMetric, SolveFailureKind } from './metrics/interface.js';
export { NoopSolveMetricSink } from './metrics/interface.js';

// ---------------------------------------------------------------------------
// solveCache (durable L2 solve-result cache — H1)
// ---------------------------------------------------------------------------
export type {
	ISolveResultCache,
	SolveCacheKey,
	SolveCacheSetOptions
} from './solveCache/interface.js';
export { NoopSolveResultCache } from './solveCache/interface.js';

// ---------------------------------------------------------------------------
// errors (unexpected-error reporting)
// ---------------------------------------------------------------------------
export type { IErrorReporter, ErrorContext } from './errors/interface.js';
export { NoopErrorReporter } from './errors/interface.js';

// ---------------------------------------------------------------------------
// logging (structured operator-facing log records)
// ---------------------------------------------------------------------------
export type { ILogger, LogFields, LogLevel } from './logging/interface.js';
export { NoopLogger } from './logging/interface.js';

// ---------------------------------------------------------------------------
// bindings (server-side resolver for schema inputs marked `source.kind === 'server'`)
// ---------------------------------------------------------------------------
export type { IBindingResolver } from './bindings/interface.js';
export { NoopBindingResolver } from './bindings/interface.js';

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------
export type { AuditUpdate, AuditSoftDelete } from './utils/audit.js';
export { auditUpdate, auditSoftDelete } from './utils/audit.js';

// ---------------------------------------------------------------------------
// top-level (context, pagination, config, errors)
// ---------------------------------------------------------------------------
export type { RequestContext } from './context.js';
export {
	SYSTEM_CONTEXT,
	hasPermission,
	requireActingOrg,
	isShareContext,
	assertNotShareContext
} from './context.js';

export type { ListOptions, DefinitionListOptions, Page } from './pagination.js';
export { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.js';

export type {
	TenancyMode,
	SelvaFlags,
	SelvaBranding,
	SelvaConfig,
	SelvaConfigFactory
} from './config.js';
export { isFlagEnabled, defineConfig } from './config.js';

export { ProviderError } from './errors.js';
