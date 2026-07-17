// Configurable provider wiring (K5) — the reusable core of the app's
// composition root, extracted so any app built on the engine gets the same
// env-driven provider selection, `selva.config.js` override hook, and lazy
// instantiation without copying it.
//
// The provider IMPLEMENTATIONS are not bundled: the caller passes a
// `ProviderRegistry` mapping choice names (the `SELVA_*_PROVIDER` env values)
// to `fromEnv`-style factories. That keeps this package free of dependencies
// on `@selvajs/local-provider` / `@selvajs/supabase-provider` — a consuming
// app registers exactly the providers it ships.
//
// Two wiring modes (unchanged from the app):
//
//   Default — providers are picked from env vars (SELVA_AUTH_PROVIDER etc.)
//   via the registry. New deployments need only a .env file.
//
//   Override — pass `configPath` (e.g. env.SELVA_CONFIG_PATH) pointing at an
//   external `selva.config.js` (absolute or CWD-relative). It is loaded
//   dynamically at boot and replaces the env-driven wiring entirely. The path
//   must resolve to an actual `.js` file — there's no TS compiler at runtime.

import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import type {
	IAuthProvider,
	IDataProvider,
	IStorageProvider,
	ISolveMetricSink,
	SelvaBranding,
	SelvaConfig,
	SelvaConfigFactory,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import { isFlagEnabled, NoopSolveMetricSink, NoopLogger, type ILogger } from '@selvajs/platform';
import { readBool, type EnvRecord } from '../compute/limits.js';

export type ProviderFactory<T> = (env: EnvRecord) => T;

/**
 * The provider implementations available to this deployment, keyed by the
 * (lowercase) choice name used in `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER`
 * / `SELVA_STORAGE_PROVIDER`.
 */
export interface ProviderRegistry {
	auth: Record<string, ProviderFactory<IAuthProvider>>;
	data: Record<string, ProviderFactory<IDataProvider>>;
	storage: Record<string, ProviderFactory<IStorageProvider>>;
}

export interface CreateSelvaProvidersOptions {
	registry: ProviderRegistry;
	/** Fallback choice per slot when the env var is unset. Default: `'local'`. */
	defaults?: Partial<Record<'auth' | 'data' | 'storage', string>>;
	/**
	 * Path to an external `selva.config.js` override (absolute or CWD-relative).
	 * Pass `env.SELVA_CONFIG_PATH` through; when set, the module's default
	 * export (a `SelvaConfig` or factory) replaces the env-driven wiring.
	 */
	configPath?: string;
	/**
	 * Boot-summary sink, called once on first `resolve()`. Kept for callers that
	 * want the rendered one-line string. Default: none — the summary goes to
	 * `logger` instead, so this library never writes to stdout unbidden.
	 */
	onBoot?: (summary: string) => void;
	/**
	 * Structured logger. Receives the boot summary as fields on first `resolve()`
	 * when `onBoot` is not supplied. Defaults to `NoopLogger`.
	 */
	logger?: ILogger;
}

export interface SelvaProviderRuntime {
	/**
	 * Memoized provider wiring. The first call instantiates providers from env
	 * (and may throw if required secrets are missing); subsequent calls return
	 * the cached config. Never call at build time — provider `fromEnv`
	 * factories validate required secrets.
	 */
	resolve(): SelvaConfig;
	tenancy(): TenancyMode;
	/** Resolved branding — every field defaulted so the UI never null-checks. */
	branding(): Required<SelvaBranding>;
	/** Safe flag accessor — omitted flags resolve to false. */
	flag(name: keyof SelvaFlags): boolean;
	/** Per-solve timing sink; `NoopSolveMetricSink` when the config omits one. */
	solveMetricSink(): ISolveMetricSink;
}

// Every SelvaFlags key, mapped from `SELVA_FLAG_<KEY>`. The `satisfies` +
// exhaustiveness check below make adding a platform flag without listing it
// here a compile error.
const FLAG_KEYS = [
	'ALLOW_CROSS_ORG_PUBLIC',
	'ALLOW_ORG_COMPUTE_OVERRIDE',
	'ALLOW_ORG_CREATION',
	'ENABLE_PLATFORM_PROJECTS',
	'ENABLE_SHARING'
] as const satisfies readonly (keyof SelvaFlags)[];

type AllFlagsListed =
	Exclude<keyof SelvaFlags, (typeof FLAG_KEYS)[number]> extends never ? true : never;

const _allFlagsListed: AllFlagsListed = true;

function pick<T>(
	env: EnvRecord,
	envVar: string,
	slot: Record<string, ProviderFactory<T>>,
	fallback: string
): T {
	const choice = (env[envVar] ?? fallback).toLowerCase();
	const factory = slot[choice];
	if (!factory) {
		throw new Error(`Unknown ${envVar}="${choice}". Expected: ${Object.keys(slot).join(' | ')}.`);
	}
	return factory(env);
}

function pickTenancy(env: EnvRecord): TenancyMode {
	const choice = (env.SELVA_TENANCY ?? 'single').toLowerCase();
	if (choice !== 'single' && choice !== 'multi') {
		throw new Error(`Unknown SELVA_TENANCY="${choice}". Expected: single | multi.`);
	}
	return choice;
}

/**
 * Per-solve metric sink. Supabase's data provider carries a `solveMetrics`
 * sink built from its own client bundle — reuse it so timings persist
 * automatically. Backends without a metrics table leave it undefined, which
 * falls back to `NoopSolveMetricSink` in `solveMetricSink()`.
 */
function pickSolveMetrics(data: IDataProvider): ISolveMetricSink | undefined {
	const candidate = (data as { solveMetrics?: unknown }).solveMetrics;
	if (candidate && typeof (candidate as { record?: unknown }).record === 'function') {
		return candidate as ISolveMetricSink;
	}
	return undefined;
}

function buildDefaultFactory(options: CreateSelvaProvidersOptions): SelvaConfigFactory {
	const { registry, defaults } = options;
	return (env) => {
		const data = pick(env, 'SELVA_DATA_PROVIDER', registry.data, defaults?.data ?? 'local');
		return {
			tenancy: pickTenancy(env),
			flags: Object.fromEntries(
				FLAG_KEYS.map((key) => [key, readBool(env, `SELVA_FLAG_${key}`, false)])
			),
			branding: {
				name: env.SELVA_BRAND_NAME,
				copyrightName: env.SELVA_BRAND_COPYRIGHT_NAME,
				tagline: env.SELVA_BRAND_TAGLINE,
				description: env.SELVA_BRAND_DESCRIPTION
			},
			auth: pick(env, 'SELVA_AUTH_PROVIDER', registry.auth, defaults?.auth ?? 'local'),
			data,
			storage: pick(env, 'SELVA_STORAGE_PROVIDER', registry.storage, defaults?.storage ?? 'local'),
			solveMetrics: pickSolveMetrics(data)
		};
	};
}

async function loadConfigSource(
	options: CreateSelvaProvidersOptions
): Promise<SelvaConfig | SelvaConfigFactory> {
	if (!options.configPath) {
		return buildDefaultFactory(options);
	}
	const abs = resolvePath(process.cwd(), options.configPath);
	if (!existsSync(abs)) {
		throw new Error(
			`Config override path ${options.configPath} resolved to ${abs} which does not exist.`
		);
	}
	// Dynamic specifier — a bundler must not pre-resolve this at build time,
	// hence @vite-ignore. pathToFileURL keeps Windows absolute paths valid as
	// ESM specifiers.
	const mod = (await import(/* @vite-ignore */ pathToFileURL(abs).href)) as {
		default: SelvaConfig | SelvaConfigFactory;
	};
	return mod.default;
}

/**
 * Build the provider runtime. Loading the *config source* (default factory,
 * or the `configPath` override module) happens here and is cheap and
 * secret-free — a factory is just a function. The factory is NOT invoked:
 * that runs the registry's `fromEnv` factories, which validate required
 * secrets, and doing it at import/build time would make merely building the
 * app require a full runtime env. Provider instantiation is deferred to the
 * first `resolve()`.
 */
export async function createSelvaProviders(
	env: EnvRecord,
	options: CreateSelvaProvidersOptions
): Promise<SelvaProviderRuntime> {
	const raw = await loadConfigSource(options);
	const logger = options.logger ?? new NoopLogger();

	let config: SelvaConfig | undefined;
	let solveMetricSink: ISolveMetricSink | undefined;

	function resolve(): SelvaConfig {
		if (config) return config;
		config = typeof raw === 'function' ? raw(env) : raw;

		// One-line boot summary so operators can confirm at a glance what got
		// wired without grepping env vars or reading the config file. Provider
		// names come from the IAuthProvider.name field; data/storage adapters
		// don't expose a name, so we infer from the constructor.
		const wiring = {
			component: 'selva',
			auth: config.auth.name,
			data: config.data.constructor.name,
			storage: config.storage.constructor.name,
			tenancy: config.tenancy ?? 'single',
			...(options.configPath ? { configPath: options.configPath } : {})
		};

		if (options.onBoot) {
			options.onBoot(
				`[selva] providers wired: ` +
					`auth=${wiring.auth} ` +
					`data=${wiring.data} ` +
					`storage=${wiring.storage} ` +
					`tenancy=${wiring.tenancy}` +
					(options.configPath ? ` config=${options.configPath}` : '')
			);
		} else {
			logger.info('Providers wired', wiring);
		}

		return config;
	}

	return {
		resolve,
		tenancy: () => resolve().tenancy ?? 'single',
		branding: () => {
			const brand = resolve().branding ?? {};
			const name = brand.name?.trim() || 'Selva';
			return {
				name,
				copyrightName: brand.copyrightName?.trim() || name,
				tagline: brand.tagline?.trim() || 'Turn Grasshopper definitions into tools anyone can use.',
				description:
					brand.description?.trim() ||
					`Build and deploy interactive web applications powered by Grasshopper definitions with ${name}.`
			};
		},
		flag: (name) => isFlagEnabled(resolve(), name),
		solveMetricSink: () => {
			if (!solveMetricSink) {
				solveMetricSink = resolve().solveMetrics ?? new NoopSolveMetricSink();
			}
			return solveMetricSink;
		}
	};
}
