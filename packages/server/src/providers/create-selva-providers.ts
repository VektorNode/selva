// Configurable provider wiring — the reusable core of an app's composition
// root.
//
// Provider IMPLEMENTATIONS are not bundled: the caller passes a
// `ProviderRegistry` mapping choice names (the `SELVA_*_PROVIDER` env values)
// to `fromEnv`-style factories. That keeps this package free of dependencies on
// `@selvajs/local-provider` / `@selvajs/supabase-provider` — a consuming app
// registers exactly the providers it ships.
//
// Two wiring modes:
//
//   Default — providers picked from env vars (SELVA_AUTH_PROVIDER etc.) via the
//   registry. New deployments need only a .env file.
//
//   Override — `configPath` points at an external `selva.config.js` (absolute
//   or CWD-relative), loaded dynamically at boot, replacing the env-driven
//   wiring entirely. It must be an actual `.js` file — there's no TS compiler
//   at runtime.

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

/** Keyed by the lowercased `SELVA_{AUTH,DATA,STORAGE}_PROVIDER` value. */
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
	 * Override module (absolute or CWD-relative); its default export is a
	 * `SelvaConfig` or a factory.
	 */
	configPath?: string;
	/**
	 * Boot-summary sink, called once on first `resolve()` — for callers that want
	 * the rendered string. Default: none, and the summary goes to `logger`
	 * instead, so this library never writes to stdout unbidden.
	 */
	onBoot?: (summary: string) => void;
	/**
	 * Receives the boot summary as fields when `onBoot` is unset. Defaults to
	 * `NoopLogger`.
	 */
	logger?: ILogger;
}

export interface SelvaProviderRuntime {
	/**
	 * Memoized wiring. The first call instantiates providers from env and throws
	 * if a required secret is missing — never call it at build time.
	 */
	resolve(): SelvaConfig;
	/** Defaults to `'single'` when the config omits it. */
	tenancy(): TenancyMode;
	/** Every field defaulted, so the UI never null-checks. */
	branding(): Required<SelvaBranding>;
	/** Omitted flags resolve to false. */
	flag(name: keyof SelvaFlags): boolean;
	/** `NoopSolveMetricSink` when the config omits one. */
	solveMetricSink(): ISolveMetricSink;
}

// Every SelvaFlags key, read from `SELVA_FLAG_<KEY>`. The `satisfies` plus the
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
 * Supabase's data provider carries a `solveMetrics` sink built from its own
 * client bundle — reuse it so timings persist without a second client. Backends
 * with no metrics table return undefined, and `solveMetricSink()` falls back to
 * `NoopSolveMetricSink`.
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
	// @vite-ignore: a bundler must not pre-resolve this specifier at build time.
	// pathToFileURL keeps Windows absolute paths valid as ESM specifiers.
	const mod = (await import(/* @vite-ignore */ pathToFileURL(abs).href)) as {
		default: SelvaConfig | SelvaConfigFactory;
	};
	return mod.default;
}

/**
 * Loading the config source (default factory, or the `configPath` module) is
 * cheap and secret-free. The factory is deliberately NOT invoked here: that
 * runs the registry's `fromEnv` factories, which validate required secrets, so
 * calling it at import time would make merely building the app require a full
 * runtime env. Providers are instantiated on the first `resolve()`.
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

		// Boot summary so operators can confirm what got wired without grepping
		// env vars. Auth exposes a `name` field; data/storage adapters don't, so
		// their names come from the constructor.
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
				tagline: brand.tagline?.trim() || '',
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
