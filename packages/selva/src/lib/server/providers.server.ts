import { env } from '$env/dynamic/private';
import type {
	IErrorReporter,
	ISolveMetricSink,
	SelvaBranding,
	SelvaConfig,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import { NoopErrorReporter } from '@selvajs/platform';
import { createSelvaProviders, type ProviderRegistry } from '@selvajs/server/providers';
import * as local from '@selvajs/local-provider';
import * as supa from '@selvajs/supabase-provider';
import * as header from '@selvajs/header-auth-provider';
import { DefinitionService } from './definitions/DefinitionService.js';
import { OrgAssetService } from './organizations/OrgAssetService.js';
import { SentryErrorReporter } from './errors/SentryErrorReporter.js';

// Provider wiring lives in `@selvajs/server/providers`
// (`createSelvaProviders`): env-driven selection over the registry below, an
// external `selva.config.js` override via SELVA_CONFIG_PATH, and lazy
// memoized instantiation (nothing touches provider secrets at import/build
// time). This file is the app's composition root: the registry of bundled
// provider implementations, the service singletons, and error reporting.

/** The provider implementations bundled with the Selva app. */
const registry: ProviderRegistry = {
	auth: {
		local: (e) => local.LocalAuthProvider.fromEnv(e),
		supabase: (e) => supa.SupabaseAuthProvider.fromEnv(e),
		header: (e) => header.HeaderAuthProvider.fromEnv(e)
	},
	data: {
		local: (e) => local.LocalDataProvider.fromEnv(e),
		supabase: (e) => supa.SupabaseDataProvider.fromEnv(e)
	},
	storage: {
		local: (e) => local.LocalStorageProvider.fromEnv(e),
		supabase: (e) => supa.SupabaseStorageProvider.fromEnv(e)
	}
};

const runtime = await createSelvaProviders(env, {
	registry,
	configPath: env.SELVA_CONFIG_PATH
});

/**
 * Memoized provider wiring. The first call instantiates providers from env
 * (and may throw if required secrets are missing); subsequent calls return the
 * cached config. Importing this module has no side effects — initialization
 * happens lazily on the first request, never at build time.
 */
export function resolveProviders(): SelvaConfig {
	return runtime.resolve();
}

/**
 * @deprecated Prefer {@link resolveProviders}. Kept as a property accessor so
 * existing `import { providers }` call sites resolve lazily instead of at
 * import time.
 */
export const providers = new Proxy({} as SelvaConfig, {
	get(_t, prop) {
		return Reflect.get(resolveProviders(), prop);
	}
});

export function getTenancy(): TenancyMode {
	return runtime.tenancy();
}

/**
 * Resolved branding — every field has a default so the UI never has to
 * null-check. White-label deployments override via SELVA_BRAND_* env vars.
 */
export function getBranding(): Required<SelvaBranding> {
	return runtime.branding();
}

/** Use this rather than reading flags directly — omitted flags resolve to false. */
export function flag(name: keyof SelvaFlags): boolean {
	return runtime.flag(name);
}

let _definitionService: DefinitionService | undefined;
export function getDefinitionService(): DefinitionService {
	if (!_definitionService) {
		const p = resolveProviders();
		_definitionService = new DefinitionService(p.data, p.storage);
	}
	return _definitionService;
}

let _orgAssetService: OrgAssetService | undefined;
export function getOrgAssetService(): OrgAssetService {
	if (!_orgAssetService) {
		const p = resolveProviders();
		_orgAssetService = new OrgAssetService(p.data.orgs, p.storage);
	}
	return _orgAssetService;
}

export function getAuthProvider() {
	return resolveProviders().auth;
}

export function getStorageProvider() {
	return resolveProviders().storage;
}

export function getDataProvider() {
	return resolveProviders().data;
}

export function getOrganizationProvider() {
	return resolveProviders().data.orgs;
}

export function getProjectProvider() {
	return resolveProviders().data.projects;
}

export function getDefinitionMeta() {
	return resolveProviders().data.definitions;
}

export function getComputeServerConfigStore() {
	return resolveProviders().data.computeServer;
}

export function getUserProfileStore() {
	return resolveProviders().data.userProfile;
}

export function getInviteStore() {
	return resolveProviders().data.invites;
}

export function getPermissionStore() {
	return resolveProviders().data.permissions;
}

export function getPlatformProjectGrantStore() {
	return resolveProviders().data.platformProjectGrants;
}

/**
 * Per-solve timing sink. Defaults to `NoopSolveMetricSink` when the config
 * omits `solveMetrics`, so the compute route can always record unconditionally.
 */
export function getSolveMetricSink(): ISolveMetricSink {
	return runtime.solveMetricSink();
}

/**
 * Optional. Null on deployments where the audit log isn't queryable
 * (local-provider stays on `NoopEventSink`; the read-side has nothing to
 * surface). Routes that consume this MUST handle null and degrade their UI.
 */
export function getAuditQuery() {
	return providers.data.auditQuery ?? null;
}

// ============================================================================
// Error reporting
// ============================================================================

// Starts as the no-op reporter and is swapped for a Sentry-backed one once its
// async init resolves (see below). `getErrorReporter()` is synchronous — called
// from `handleError` and the process error hooks, which can't await — so during
// the sub-second boot window before Sentry finishes loading, reports go to the
// no-op. Acceptable: the only errors lost are ones thrown in that window.
let _errorReporter: IErrorReporter = new NoopErrorReporter();

/**
 * Unexpected-error reporter. Ships errors off-box (Sentry) only when
 * `SENTRY_DSN` is configured; otherwise a no-op, so self-hosters opt in via
 * env and the base install carries no error-tracking dependency.
 *
 * This reports ONLY genuinely unexpected errors. Intentional HTTP outcomes —
 * including the compute route's `apiError(500, …)` on a failed solve — are
 * thrown as SvelteKit `HttpError`s and short-circuit in `handleError` before
 * ever reaching this reporter. Compute failures are not tracked here by design.
 */
export function getErrorReporter(): IErrorReporter {
	return _errorReporter;
}

// Eager, fire-and-forget init at module load. Kept out of `getErrorReporter()`
// so the getter stays sync and allocation-free on the hot error path.
if (env.SENTRY_DSN) {
	void SentryErrorReporter.create({
		dsn: env.SENTRY_DSN,
		environment: env.NODE_ENV,
		release: env.SELVA_RELEASE
	}).then((reporter) => {
		if (reporter) {
			_errorReporter = reporter;
			console.log('[ErrorReporter] Sentry error tracking enabled.');
		}
	});
}

// Process-level safety net. `handleError` only sees errors on the request path;
// a rejected promise with no awaiter (or a throw outside any request) bypasses
// it entirely and would otherwise vanish into a bare `console.error` — or, for
// an uncaught exception, crash the process silently. Report both, then let the
// default behavior stand (Node logs uncaughtException and exits; we don't
// swallow it and pretend the process is healthy). Guarded so repeated module
// evaluation in dev/HMR doesn't stack duplicate listeners.
const ERROR_HOOKS_FLAG = '__selvaProcessErrorHooksRegistered';
if (!(globalThis as Record<string, unknown>)[ERROR_HOOKS_FLAG]) {
	(globalThis as Record<string, unknown>)[ERROR_HOOKS_FLAG] = true;
	process.on('unhandledRejection', (reason) => {
		console.error('[unhandledRejection]', reason);
		getErrorReporter().capture(reason, { tags: { origin: 'unhandledRejection' } });
	});
	process.on('uncaughtException', (error) => {
		console.error('[uncaughtException]', error);
		getErrorReporter().capture(error, { tags: { origin: 'uncaughtException' } });
	});
}
