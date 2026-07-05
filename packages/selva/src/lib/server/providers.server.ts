import { env } from '$env/dynamic/private';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import type {
	IAuthProvider,
	IDataProvider,
	IErrorReporter,
	IStorageProvider,
	ISolveMetricSink,
	SelvaBranding,
	SelvaConfig,
	SelvaConfigFactory,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import {
	defineConfig,
	isFlagEnabled,
	NoopSolveMetricSink,
	NoopErrorReporter
} from '@selvajs/platform';
import * as local from '@selvajs/local-provider';
import * as supa from '@selvajs/supabase-provider';
import * as header from '@selvajs/header-auth-provider';
import { DefinitionService } from './definitions/DefinitionService.js';
import { OrgAssetService } from './organizations/OrgAssetService.js';
import { SentryErrorReporter } from './errors/SentryErrorReporter.js';

/**
 * Provider wiring source. Two modes:
 *
 *   Default — providers are picked from env vars (SELVA_AUTH_PROVIDER etc.)
 *   and instantiated via the bundled provider implementations. New deployments
 *   need only a .env file — no selva.config.js.
 *
 *   Override — set `SELVA_CONFIG_PATH` to point at an external
 *   `selva.config.js` (absolute or CWD-relative). The runtime loads it
 *   dynamically at boot, replacing the default env-driven wiring entirely.
 *   Use this only when you need a custom provider not shipped in the box.
 *
 * The override path must resolve to an actual `.js` file — there's no TS
 * compiler at runtime.
 */

type Env = Record<string, string | undefined>;

function envBool(e: Env, key: string): boolean {
	const v = e[key]?.toLowerCase();
	return v === 'true' || v === '1' || v === 'yes';
}

function pickAuth(e: Env): IAuthProvider {
	const choice = (e.SELVA_AUTH_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalAuthProvider.fromEnv(e);
		case 'supabase':
			return supa.SupabaseAuthProvider.fromEnv(e);
		case 'header':
			return header.HeaderAuthProvider.fromEnv(e);
		default:
			throw new Error(
				`Unknown SELVA_AUTH_PROVIDER="${choice}". Expected: local | supabase | header.`
			);
	}
}

function pickData(e: Env): IDataProvider {
	const choice = (e.SELVA_DATA_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalDataProvider.fromEnv(e);
		case 'supabase':
			return supa.SupabaseDataProvider.fromEnv(e);
		default:
			throw new Error(`Unknown SELVA_DATA_PROVIDER="${choice}". Expected: local | supabase.`);
	}
}

function pickStorage(e: Env): IStorageProvider {
	const choice = (e.SELVA_STORAGE_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalStorageProvider.fromEnv(e);
		case 'supabase':
			return supa.SupabaseStorageProvider.fromEnv(e);
		default:
			throw new Error(`Unknown SELVA_STORAGE_PROVIDER="${choice}". Expected: local | supabase.`);
	}
}

/**
 * Per-solve metric sink. Supabase's data provider carries a `solveMetrics`
 * sink built from its own client bundle — reuse it so timings persist
 * automatically. Other backends (local) have no metrics table; left undefined,
 * which falls back to `NoopSolveMetricSink` in `getSolveMetricSink()`.
 */
function pickSolveMetrics(data: IDataProvider): ISolveMetricSink | undefined {
	const candidate = (data as { solveMetrics?: unknown }).solveMetrics;
	if (candidate && typeof (candidate as { record?: unknown }).record === 'function') {
		return candidate as ISolveMetricSink;
	}
	return undefined;
}

function pickTenancy(e: Env): TenancyMode {
	const choice = (e.SELVA_TENANCY ?? 'single').toLowerCase();
	if (choice !== 'single' && choice !== 'multi') {
		throw new Error(`Unknown SELVA_TENANCY="${choice}". Expected: single | multi.`);
	}
	return choice;
}

const defaultConfig = defineConfig((e) => {
	const data = pickData(e);
	return {
		tenancy: pickTenancy(e),
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: envBool(e, 'SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC'),
			ALLOW_ORG_COMPUTE_OVERRIDE: envBool(e, 'SELVA_FLAG_ALLOW_ORG_COMPUTE_OVERRIDE'),
			ALLOW_ORG_CREATION: envBool(e, 'SELVA_FLAG_ALLOW_ORG_CREATION'),
			ENABLE_PLATFORM_PROJECTS: envBool(e, 'SELVA_FLAG_ENABLE_PLATFORM_PROJECTS'),
			ENABLE_SHARING: envBool(e, 'SELVA_FLAG_ENABLE_SHARING')
		},
		branding: {
			name: e.SELVA_BRAND_NAME,
			copyrightName: e.SELVA_BRAND_COPYRIGHT_NAME,
			tagline: e.SELVA_BRAND_TAGLINE,
			description: e.SELVA_BRAND_DESCRIPTION
		},
		auth: pickAuth(e),
		data,
		storage: pickStorage(e),
		solveMetrics: pickSolveMetrics(data)
	};
});

async function loadRawConfig(): Promise<SelvaConfig | SelvaConfigFactory> {
	const override = env.SELVA_CONFIG_PATH;
	if (!override) {
		return defaultConfig;
	}

	const abs = resolvePath(process.cwd(), override);
	if (!existsSync(abs)) {
		throw new Error(`SELVA_CONFIG_PATH=${override} resolved to ${abs} which does not exist.`);
	}
	// Dynamic specifier — Vite must not pre-resolve this at build time, hence
	// @vite-ignore. pathToFileURL keeps Windows absolute paths valid as ESM
	// specifiers.
	const mod = (await import(/* @vite-ignore */ pathToFileURL(abs).href)) as {
		default: SelvaConfig | SelvaConfigFactory;
	};
	return mod.default;
}

// Loading the *config source* (default factory, or the SELVA_CONFIG_PATH
// override module) is cheap and secret-free — a factory is just a function.
// We do that eagerly. We do NOT invoke the factory here: calling it runs
// pickAuth/pickData/pickStorage → provider.fromEnv(), which validates required
// secrets (SELVA_HMAC_KEY etc.). Doing that at import time would make merely
// *building* the app require a full runtime env, which breaks `vite build` and
// any tool that loads the SSR bundle. So provider instantiation is deferred to
// first use via resolveProviders().
const _raw = await loadRawConfig();

let _providers: SelvaConfig | undefined;

/**
 * Memoized provider wiring. The first call instantiates providers from env
 * (and may throw if required secrets are missing); subsequent calls return the
 * cached config. Importing this module has no side effects — initialization
 * happens lazily on the first request, never at build time.
 */
export function resolveProviders(): SelvaConfig {
	if (_providers) return _providers;
	_providers = typeof _raw === 'function' ? _raw(env) : _raw;

	// One-line boot summary so operators can confirm at a glance what got wired
	// without grepping env vars or reading the config file. Provider names come
	// from the IAuthProvider.name field; data/storage adapters don't expose a
	// name, so we infer from the constructor.
	console.info(
		`[selva] providers wired: ` +
			`auth=${_providers.auth.name} ` +
			`data=${_providers.data.constructor.name} ` +
			`storage=${_providers.storage.constructor.name} ` +
			`tenancy=${_providers.tenancy ?? 'single'}` +
			(env.SELVA_CONFIG_PATH ? ` config=${env.SELVA_CONFIG_PATH}` : '')
	);

	return _providers;
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
	return resolveProviders().tenancy ?? 'single';
}

/**
 * Resolved branding — every field has a default so the UI never has to
 * null-check. White-label deployments override via SELVA_BRAND_* env vars.
 */
export function getBranding(): Required<SelvaBranding> {
	const brand = resolveProviders().branding ?? {};
	const name = brand.name?.trim() || 'Selva';
	return {
		name,
		copyrightName: brand.copyrightName?.trim() || name,
		tagline: brand.tagline?.trim() || 'Turn Grasshopper definitions into tools anyone can use.',
		description:
			brand.description?.trim() ||
			`Build and deploy interactive web applications powered by Grasshopper definitions with ${name}.`
	};
}

/** Use this rather than reading flags directly — omitted flags resolve to false. */
export function flag(name: keyof SelvaFlags): boolean {
	return isFlagEnabled(resolveProviders(), name);
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

let _solveMetricSink: ISolveMetricSink | undefined;

/**
 * Per-solve timing sink. Defaults to `NoopSolveMetricSink` when the config
 * omits `solveMetrics`, so the compute route can always record unconditionally.
 */
export function getSolveMetricSink(): ISolveMetricSink {
	if (!_solveMetricSink) {
		_solveMetricSink = resolveProviders().solveMetrics ?? new NoopSolveMetricSink();
	}
	return _solveMetricSink;
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
