// @selvajs/platform — published API contract. Every symbol here is breaking-change-protected.

export * from './access/index.js';
export * from './apiTokens/index.js';
export * from './auth/index.js';
export * from './computeServer/public.js';
export * from './data/index.js';
export * from './definitions/index.js';
export * from './events/index.js';
export * from './invites/index.js';
export * from './notifications/index.js';
export * from './organizations/index.js';
export * from './permissions/index.js';
export * from './platformProjects/index.js';
export * from './projects/index.js';
export * from './shareLinks/index.js';
export * from './storage/index.js';
export * from './userProfile/index.js';
export * from './utils/index.js';

// Areas without an index of their own.
export type { ISolveMetricSink, SolveMetric, SolveFailureKind } from './metrics/interface.js';
export { NoopSolveMetricSink } from './metrics/interface.js';

export type {
	ISolveResultCache,
	SolveCacheKey,
	SolveCacheSetOptions
} from './solveCache/interface.js';
export { NoopSolveResultCache } from './solveCache/interface.js';

export type { IErrorReporter, ErrorContext } from './errors/interface.js';
export { NoopErrorReporter } from './errors/interface.js';

export type { ILogger, LogFields, LogLevel } from './logging/interface.js';
export { NoopLogger } from './logging/interface.js';

export type { IBindingResolver } from './bindings/interface.js';
export { NoopBindingResolver } from './bindings/interface.js';

export type { RequestContext } from './context.js';
export {
	SYSTEM_CONTEXT,
	hasPermission,
	requireActingOrg,
	isShareContext,
	assertNotShareContext
} from './context.js';

export type { ListOptions, DefinitionListOptions, Page } from './pagination.js';
export {
	DEFAULT_PAGE_LIMIT,
	MAX_PAGE_LIMIT,
	clampPageLimit,
	decodeOffsetCursor,
	encodeOffsetCursor
} from './pagination.js';

export type {
	TenancyMode,
	SelvaFlags,
	SelvaBranding,
	SelvaConfig,
	SelvaConfigFactory
} from './config.js';
export { isFlagEnabled, defineConfig } from './config.js';

export { ProviderError } from './errors.js';
