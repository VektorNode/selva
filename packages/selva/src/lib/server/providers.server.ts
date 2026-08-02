import { env } from '$env/dynamic/private';
import type {
	IErrorReporter,
	IEventSink,
	ILogger,
	ISolveMetricSink,
	LogFields,
	LogLevel,
	SelvaBranding,
	SelvaConfig,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import { NoopErrorReporter, NoopEventSink } from '@selvajs/platform';
import { createSelvaProviders, type ProviderRegistry } from '@selvajs/server/providers';
import * as local from '@selvajs/local-provider';
import * as supa from '@selvajs/supabase-provider';
import * as header from '@selvajs/header-auth-provider';
import { DefinitionService } from './definitions/DefinitionService.js';
import { OrgAssetService } from './organizations/OrgAssetService.js';
import { SentryErrorReporter } from '@selvajs/server/errors';
import { ConsoleLogger, createLogger, renderThrown } from '@selvajs/server/logging';

// Provider wiring lives in `@selvajs/server/providers`
// (`createSelvaProviders`): env-driven selection over the registry below, an
// external `selva.config.js` override via SELVA_CONFIG_PATH, and lazy
// memoized instantiation (nothing touches provider secrets at import/build
// time). This file is the app's composition root: the registry of bundled
// provider implementations, the service singletons, and error reporting.

/**
 * Forwards to whatever the root logger currently is, rather than capturing it.
 *
 * Provider wiring runs at module scope, while `_logger` starts as a console
 * placeholder and is swapped for pino once its async load resolves (see the
 * Logging section below). A provider handed `getLogger()` directly at
 * construction would pin the placeholder for the process's whole life; this
 * indirection keeps a long-lived provider on the current logger.
 */
export const lazyLogger: ILogger = {
	debug: (m: string, f?: LogFields) => getLogger().debug(m, f),
	info: (m: string, f?: LogFields) => getLogger().info(m, f),
	warn: (m: string, f?: LogFields) => getLogger().warn(m, f),
	error: (m: string, f?: LogFields) => getLogger().error(m, f),
	child: (f: LogFields) => getLogger().child(f)
};

/** The provider implementations bundled with the Selva app. */
const registry: ProviderRegistry = {
	auth: {
		local: (e) => local.LocalAuthProvider.fromEnv(e),
		supabase: (e) => supa.SupabaseAuthProvider.fromEnv(e, lazyLogger),
		header: (e) => header.HeaderAuthProvider.fromEnv(e, lazyLogger)
	},
	data: {
		local: (e) => local.LocalDataProvider.fromEnv(e),
		// `events` is the second param and stays defaulted — the app wires its
		// event sink separately (see getEventSink below); the logger is third.
		supabase: (e) => supa.SupabaseDataProvider.fromEnv(e, undefined, lazyLogger)
	},
	storage: {
		local: (e) => local.LocalStorageProvider.fromEnv(e),
		supabase: (e) => supa.SupabaseStorageProvider.fromEnv(e)
	}
};

const runtime = await createSelvaProviders(env, {
	registry,
	configPath: env.SELVA_CONFIG_PATH,
	logger: lazyLogger
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

// Never-null via the Noop fallback, so emitters record unconditionally.
const noopEventSink = new NoopEventSink();

/**
 * Write-side event sink for routes with no store mutation to piggyback on
 * (e.g. the self-update lifecycle events, audit O2). Prefers the explicit
 * `SelvaConfig.events`, then the data provider's own sink, then a no-op —
 * mirroring how the stores themselves are wired.
 */
export function getEventSink(): IEventSink {
	const p = resolveProviders();
	return p.events ?? p.data.events ?? noopEventSink;
}

// ============================================================================
// Logging
// ============================================================================

// Same eager-init-then-swap shape as the error reporter below, with one
// deliberate difference: the placeholder is a real ConsoleLogger, never a
// no-op. Logging must not have a window where warnings vanish — an operator
// debugging a boot failure is reading exactly these lines. So records written
// before pino resolves land on the console, and the swap only upgrades the
// formatting.
const LOG_LEVEL: LogLevel = parseLogLevel(env.LOG_LEVEL);

let _logger: ILogger = new ConsoleLogger({}, LOG_LEVEL);

/**
 * The app's root logger. Structured, correlated, and pino-backed when `pino` is
 * installed (it ships with the app; the base `@selvajs/server` install treats it
 * as an optional peer and falls back to the console).
 *
 * Prefer a request-scoped child — `event.locals.log` — inside route handlers, so
 * records carry `requestId`/`route`. Use this root logger for boot, shutdown and
 * background work that belongs to no request.
 */
export function getLogger(): ILogger {
	return _logger;
}

/**
 * `LOG_LEVEL` is operator input, so an unrecognized value must not crash boot
 * (or silently disable logging). Default to `info`, and to `debug` in dev where
 * the extra detail is the point.
 */
function parseLogLevel(raw: string | undefined): LogLevel {
	const value = raw?.trim().toLowerCase();
	if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
	// SELVA_FLAG_COMPUTE_DEBUG emits at `debug`. An operator who set it has asked
	// for that output in so many words, so honor it without also demanding
	// LOG_LEVEL=debug — otherwise the flag would silently do nothing in
	// production, which is exactly where it gets reached for.
	if (
		['true', '1', 'yes', 'on', 'verbose'].includes(
			(env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase()
		)
	)
		return 'debug';
	return env.NODE_ENV === 'development' ? 'debug' : 'info';
}

// Eager, fire-and-forget: `getLogger()` stays sync for the same reason
// `getErrorReporter()` does — its callers (hooks, process handlers) can't await.
void createLogger({
	level: LOG_LEVEL,
	// Pretty output in dev, newline-delimited JSON in production for the
	// collector. `pino-pretty` is a devDependency, so this silently degrades to
	// JSON if it's absent.
	pretty: env.NODE_ENV === 'development',
	base: { service: 'selva', release: env.SELVA_RELEASE }
}).then((logger) => {
	_logger = logger;
});

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
			getLogger().info('Sentry error tracking enabled', { component: 'ErrorReporter' });
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
		getLogger().error('Unhandled promise rejection', {
			component: 'process',
			origin: 'unhandledRejection',
			err: renderThrown(reason)
		});
		getErrorReporter().capture(reason, { tags: { origin: 'unhandledRejection' } });
	});
	process.on('uncaughtException', (error) => {
		// Also write straight to the console here: Node is about to exit, and a
		// buffered/async log transport may never flush. The duplicate line is a
		// cheap price for not losing the record that explains the crash.
		console.error('[uncaughtException]', error);
		getLogger().error('Uncaught exception', {
			component: 'process',
			origin: 'uncaughtException',
			err: renderThrown(error)
		});
		getErrorReporter().capture(error, { tags: { origin: 'uncaughtException' } });
	});
}
