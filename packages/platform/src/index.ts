// Auth
export type {
	IAuthProvider,
	IPasswordAuth,
	AuthUser,
	PlatformPermission,
	UserManagementResult,
	RecentRun,
	LoginResult,
	MfaFactor
} from './auth/index.js';
export { ALL_PLATFORM_PERMISSIONS, PlatformPermissionSchema } from './auth/index.js';

// User profile
export type { IUserProfileStore, UserProfile } from './userProfile/index.js';
export { emptyProfile } from './userProfile/index.js';

// Organizations
export type {
	Organization,
	OrgRole,
	OrgPermission,
	OrgMember,
	CreateOrgInput,
	UpdateOrgInput
} from './organizations/index.js';
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
} from './organizations/index.js';

// Invites
export type { Invite, IInviteStore } from './invites/index.js';
export {
	CreateInviteInputSchema,
	AcceptInviteInputSchema,
	type CreateInviteInput,
	type AcceptInviteInput
} from './invites/index.js';

// Projects
export type {
	Project,
	ProjectVisibility,
	ProjectRole,
	ProjectMember,
	CreateProjectInput,
	UpdateProjectInput
} from './projects/index.js';
export {
	ProjectVisibilitySchema,
	ProjectRoleSchema,
	CreateProjectSchema,
	UpdateProjectSchema,
	validateProjectFlags
} from './projects/index.js';

// Definitions
export type {
	DefinitionFileExt,
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionStatus,
	DefinitionVersion,
	DefinitionChannel
} from './definitions/index.js';
export {
	GH_EXTENSIONS,
	COVER_IMAGE_EXTENSIONS,
	ALLOWED_UPLOAD_EXTENSIONS,
	COVER_IMAGE_CONTENT_TYPES,
	definitionPaths
} from './definitions/index.js';
export type { UpdateMetadataInput } from './definitions/schemas.js';
export {
	DefinitionVersionSchema,
	DefinitionChannelSchema,
	DefinitionFileExtSchema,
	PublishVersionInputSchema
} from './definitions/schemas.js';

// Storage
export type { IStorageProvider, TranscodeResult } from './storage/index.js';
export {
	IMAGE_MAX_WIDTH,
	IMAGE_WEBP_QUALITY,
	isImageUpload,
	toWebpPath,
	transcodeImageIfNeeded
} from './storage/index.js';

// Data
export type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IShareLinkStore
} from './data/index.js';

// Share links (spec §7)
export type { ShareLink, CreateShareLinkInput } from './shareLinks/index.js';
export {
	DEFAULT_SHARE_LINK_MAX_SOLVES,
	CreateShareLinkInputSchema
} from './shareLinks/index.js';

// Request context
export type { RequestContext } from './context.js';
export { SYSTEM_CONTEXT, hasPermission } from './context.js';

// Pagination
export type { ListOptions, DefinitionListOptions, Page } from './pagination.js';
export { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.js';

// Compute server
export type { ComputeServerConfig, ComputeConfig } from './computeServer/index.js';
export type { OrgComputeOptions } from './computeServer/index.js';
export {
	resolveComputeServer,
	resolveServerById,
	resolveComputeServerForOrg
} from './computeServer/index.js';

// Config
export type { SelvaConfig, SelvaConfigFactory, SelvaFlags, TenancyMode } from './config.js';
export { defineConfig, isFlagEnabled } from './config.js';

// Errors
export { ProviderError } from './errors.js';

// Audit-field stamping helpers (Permissions.md §9)
export type { AuditUpdate, AuditSoftDelete } from './utils/index.js';
export { auditUpdate, auditSoftDelete } from './utils/index.js';

// Domain events (Permissions.md §9 — every mutation emits one)
export type { DomainEvent, DomainEventType, IEventSink } from './events/index.js';
export { actorFrom, NoopEventSink } from './events/index.js';

// Access control (UI-gating rules — mutating stores re-enforce independently)
export type {
	ProjectAccessInput,
	DefinitionAccessInput,
	VisibilityChangeInput,
	ReclaimAccessInput,
	CreateProjectAccessInput
} from './access/index.js';
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
	withAdminBypass
} from './access/index.js';
