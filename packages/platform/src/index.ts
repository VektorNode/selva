// Auth
export type { IAuthProvider, IPasswordAuth, AuthUser, Permission, UserManagementResult, RecentRun } from './auth/index.js';
export { ALL_PERMISSIONS, PermissionSchema, hasPermission } from './auth/index.js';

// User profile
export type { IUserProfileStore } from './userProfile/index.js';

// Organizations
export type { Organization, OrgRole, OrgMember } from './organizations/index.js';

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
	ProjectMember
} from './projects/index.js';
export { ProjectVisibilitySchema, ProjectRoleSchema } from './projects/index.js';

// Definitions
export type {
	DefinitionFileExt,
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionStatus,
	HistoryEntry
} from './definitions/index.js';
export {
	GH_EXTENSIONS,
	COVER_IMAGE_EXTENSIONS,
	ALLOWED_UPLOAD_EXTENSIONS,
	COVER_IMAGE_CONTENT_TYPES,
	definitionPaths
} from './definitions/index.js';
export type { UpdateMetadataInput } from './definitions/schemas.js';

// Storage
export type { IStorageProvider } from './storage/index.js';

// Data
export type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore
} from './data/index.js';

// Request context
export type { RequestContext } from './context.js';
export { SYSTEM_CONTEXT } from './context.js';

// Pagination
export type { ListOptions, DefinitionListOptions, Page } from './pagination.js';
export { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.js';

// Compute server
export type { ComputeServerConfig, ComputeConfig } from './computeServer/index.js';
export { resolveComputeServer, resolveServerById } from './computeServer/index.js';

// Config
export type { SelvaConfig, SelvaConfigFactory } from './config.js';
export { defineConfig } from './config.js';

// Errors
export { ProviderError } from './errors.js';

// Access control (UI-gating rules — mutating stores re-enforce independently)
export type { ProjectAccessInput, DefinitionAccessInput } from './access/index.js';
export {
	canSolve,
	canEdit,
	canManage,
	canEditProjectSettings,
	canEditDefinition
} from './access/index.js';
