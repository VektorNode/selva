// ============================================================================
// @selvajs/platform — public API
// ============================================================================
// This file IS the contract. Every symbol below is part of the published API
// and removing or changing one is a breaking change. Add a symbol here only
// when you intend to commit to it long-term; otherwise keep it internal to
// its module.

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
export type { AuthUser, UserManagementResult, LoginResult } from './auth/types.js';
export type {
	IAuthProvider,
	IOAuthAuth,
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

// ---------------------------------------------------------------------------
// userProfile
// ---------------------------------------------------------------------------
export type { IUserProfileStore } from './userProfile/interface.js';
export type { UserProfile, RecentRun } from './userProfile/types.js';
export { emptyProfile } from './userProfile/types.js';

// ---------------------------------------------------------------------------
// organizations
// ---------------------------------------------------------------------------
export type { Organization, OrgMember } from './organizations/types.js';
export type { IOrgStore } from './organizations/interface.js';
export type {
	OrgRole,
	OrgPermission,
	CreateOrgInput,
	UpdateOrgInput
} from './organizations/schemas.js';
export {
	OrgRoleSchema,
	OrgPermissionSchema,
	SlugSchema,
	CreateOrgSchema,
	UpdateOrgSchema,
	ALL_ORG_PERMISSIONS,
	DEFAULT_ORG_PERMISSIONS,
	OWNER_ADMIN_ONLY_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS
} from './organizations/schemas.js';

// ---------------------------------------------------------------------------
// invites
// ---------------------------------------------------------------------------
export type { Invite } from './invites/types.js';
export type { IInviteStore } from './invites/interface.js';

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------
export type { Project, ProjectMember } from './projects/types.js';
export type { IProjectStore } from './projects/interface.js';
export type { ProjectVisibility, ProjectRole } from './projects/schemas.js';
export {
	ProjectVisibilitySchema,
	ProjectRoleSchema,
	validateProjectFlags
} from './projects/schemas.js';

// ---------------------------------------------------------------------------
// platformProjects
// ---------------------------------------------------------------------------
export type { PlatformProjectGrant, PlatformProjectGranteeType } from './platformProjects/types.js';
export type { IPlatformProjectGrantStore } from './platformProjects/interface.js';
export {
	PlatformProjectGrantSchema,
	PlatformProjectGranteeTypeSchema
} from './platformProjects/schemas.js';

// ---------------------------------------------------------------------------
// definitions
// ---------------------------------------------------------------------------
export type {
	DefinitionFileExt,
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
	COVER_IMAGE_CONTENT_TYPES
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
export type { ShareLink } from './shareLinks/types.js';
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

// ---------------------------------------------------------------------------
// data (composition root)
// ---------------------------------------------------------------------------
export type { IDataProvider } from './data/interface.js';

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
export type { IComputeServerStore } from './computeServer/interface.js';
export type { ResolveOptions } from './computeServer/utils.js';
export {
	serversVisibleTo,
	defaultServerIdFor,
	resolveServerForOrg,
	findServerById,
	platformServers,
	orgServersFor
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
	checkOwnerRemoval,
	withAdminBypass
} from './access/rules.js';

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------
export type { DomainEvent, DomainEventType, IEventSink } from './events/interface.js';
export { actorFrom, NoopEventSink } from './events/interface.js';
export type {
	AuditEventRow,
	AuditCursor,
	AuditQueryFilters,
	AuditQueryResult,
	IAuditQuery
} from './events/audit.js';

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
export { SYSTEM_CONTEXT, hasPermission } from './context.js';

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
