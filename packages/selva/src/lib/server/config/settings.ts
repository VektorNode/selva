import {
	buildConfigReport,
	composeManifest,
	previousKey,
	readSetting,
	type KeyRotation,
	defineSetting,
	takeSnapshot,
	type ConfigReport,
	type ConfigSnapshot,
	type EnvRecord,
	type Manifest
} from '@selvajs/platform/config';
import { ENGINE_SETTINGS } from '@selvajs/server/config';
import { HEADER_AUTH_SETTINGS } from '@selvajs/header-auth-provider/config';
import { LOCAL_SETTINGS } from '@selvajs/local-provider/config';
import { SUPABASE_SETTINGS } from '@selvajs/supabase-provider/config';

const COMPUTE_DEBUG = defineSetting({
	key: 'SELVA_FLAG_COMPUTE_DEBUG',
	label: 'Compute debug logging',
	type: 'string',
	default: 'off',
	onInvalid: 'default',
	class: 'setting',
	description:
		'off, on (cache and timing lines per solve) or verbose (adds Compute’s raw error bodies).',
	impact: 'verbose can write what was solved to the log, which erasure cannot reach.'
});

/** `SELVA_FLAG_COMPUTE_DEBUG`: `verbose`, or on and off in the manifest's boolean words. */
export function computeDebugMode(env: EnvRecord): 'off' | 'on' | 'verbose' {
	if ((readSetting(COMPUTE_DEBUG, env) as string).toLowerCase() === 'verbose') return 'verbose';
	return readSetting({ ...COMPUTE_DEBUG, type: 'bool', default: false }, env) ? 'on' : 'off';
}

/** Keys only this app reads. adapter-node's own keys are here too: they decide whether it works. */
export const APP_SETTINGS = composeManifest([
	defineSetting({
		key: 'ORIGIN',
		label: 'Public address',
		type: 'url',
		origin: true,
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'The URL people use to reach Selva, such as https://selva.example.com.',
		impact:
			'Wrong or unset behind a proxy: form posts fail the CSRF check and invite links carry an internal host.'
	}),
	defineSetting({
		key: 'PORT',
		label: 'Port',
		type: 'int',
		min: 1,
		max: 65535,
		default: 3000,
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Port the app listens on.'
	}),
	defineSetting({
		key: 'HOST',
		label: 'Listen address',
		type: 'string',
		default: '0.0.0.0',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description:
			'Which network address the app accepts connections on. 127.0.0.1 when a proxy sits in front.',
		impact: 'Under header auth, anything that reaches the port directly can claim to be any user.'
	}),
	defineSetting({
		key: 'BODY_SIZE_LIMIT',
		label: 'Max request size',
		type: 'string',
		default: '512K',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Largest request the server accepts at all, uploads included (K, M or G suffix).',
		impact: 'Below COMPUTE_REQUEST_MAX_BYTES, uploads and file inputs fail with 413.'
	}),
	defineSetting({
		key: 'ADDRESS_HEADER',
		label: 'Visitor IP header',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description:
			'Header your proxy uses to pass on the visitor’s IP address. Usually X-Forwarded-For.',
		impact: 'Unset behind a proxy: every client shares one rate-limit bucket.'
	}),
	defineSetting({
		key: 'XFF_DEPTH',
		label: 'Proxies in front',
		type: 'int',
		min: 1,
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'How many proxies sit between visitors and the app. Usually 1.'
	}),
	defineSetting({
		key: 'PROTOCOL_HEADER',
		label: 'Protocol header',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Header carrying the original protocol, when ORIGIN is unset.'
	}),
	defineSetting({
		key: 'HOST_HEADER',
		label: 'Host header',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Header carrying the original host, when ORIGIN is unset.'
	}),
	defineSetting({
		key: 'NODE_ENV',
		label: 'Run mode',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'production in deployments: hides stack traces and makes cookies Secure.'
	}),
	defineSetting({
		key: 'ALLOW_INSECURE_COOKIES',
		label: 'Allow sign-in over http',
		type: 'bool',
		default: false,
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Drop the Secure cookie flag so sign-in works over plain http.',
		legacy: { bool: 'exact-true' }
	}),
	defineSetting({
		key: 'INSTALL_DIR',
		label: 'Install folder',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description:
			'Deployment directory the admin updater runs in. Defaults to the working directory.'
	}),
	defineSetting({
		key: 'SELVA_EVENT_CALLBACK_ORIGIN',
		label: 'Solve event callback address',
		type: 'url',
		origin: true,
		onInvalid: 'fail',
		class: 'bootstrap',
		description:
			'Origin Rhino.Compute posts live solve events to, when it differs from the browser’s.'
	}),
	defineSetting({
		key: 'MCP_ALLOWED_ORIGINS',
		label: 'Extra MCP origins',
		type: 'list',
		default: [],
		onInvalid: 'fail',
		class: 'setting',
		description: 'Browser origins /mcp accepts besides its own.'
	}),
	defineSetting({
		key: 'LOG_LEVEL',
		label: 'Log level',
		type: 'enum',
		values: ['debug', 'info', 'warn', 'error'],
		onInvalid: 'default',
		class: 'setting',
		description: 'Lowest severity written to the log. Default info (debug in development).'
	}),
	COMPUTE_DEBUG,
	defineSetting({
		key: 'SENTRY_DSN',
		label: 'Sentry error reporting',
		type: 'url',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description:
			'Ship unexpected server errors to Sentry, scrubbed of cookies, auth headers, bodies and query strings.'
	}),
	defineSetting({
		key: 'SENTRY_TRACES_SAMPLE_RATE',
		label: 'Sentry trace sampling',
		type: 'string',
		default: '0',
		onInvalid: 'default',
		class: 'tunable',
		description:
			'Share of requests traced to Sentry, 0–1 (out of range is clamped). 0 sends errors only.'
	}),
	defineSetting({
		key: 'SELVA_RELEASE',
		label: 'Release tag',
		type: 'string',
		onInvalid: 'fail',
		class: 'tunable',
		description: 'Release tag on Sentry events and log records.'
	})
]);

/** Prefixes whose undeclared keys are reported as unknown (likely typos). */
export const WATCHED_PREFIXES = [
	'SELVA_',
	'SUPABASE_',
	'COMPUTE_',
	'SMTP_',
	'HEADER_AUTH_',
	'API_TOKEN_',
	'MAX_',
	'REMOTE_DEFINITION_',
	'SIGN_IN_',
	'BOOTSTRAP_'
] as const;

/** Read by tooling, not by the app: not unknown, not reported. */
export const EXTERNAL_KEYS = ['SELVA_REQUIRE_SUPABASE'] as const;

/**
 * Keys no release reads any more, with what took their place. Boot and doctor
 * name them instead of calling them typos; `selva migrate` removes them.
 */
export const RETIRED_KEYS: Readonly<Record<string, string>> = {
	SELVA_FLAG_COMPUTE_DEBUG_VERBOSE: 'use SELVA_FLAG_COMPUTE_DEBUG=verbose',
	COMPUTE_RATE_LIMIT_WINDOW_MS: 'fixed at 100 s',
	API_TOKEN_RATE_LIMIT_WINDOW_MS: 'fixed at 60 s',
	MAX_IMAGE_FILE_SIZE_BYTES: 'fixed at 10 MB',
	COMPUTE_REQUEST_MAX_BYTES: 'fixed at 256 MB',
	COMPUTE_RESPONSE_MAX_BYTES: 'fixed at 300 MB',
	REMOTE_DEFINITION_FETCH_TIMEOUT_MS: 'fixed at 30 s',
	REMOTE_DEFINITION_CACHE_TTL_MS: 'fixed at 5 min',
	DEFINITION_CACHE_TTL_MS: 'fixed at 5 min',
	SUPABASE_TOKEN_VERIFICATION: 'always hybrid',
	SUPABASE_REVALIDATE_MS: 'fixed at 60 s',
	SUPABASE_PRIVATE_URL_PREFIX: 'fixed at /api/files',
	COMPUTE_SOLVE_DEADLINE_MS: 'set --timeout (RHINO_COMPUTE_TIMEOUT) on the compute server',
	MAX_SOLVE_DURATION_MS: 'set --timeout (RHINO_COMPUTE_TIMEOUT) on the compute server',
	COMPUTE_REUSE_DEFINITION_CACHE: 'on whenever the compute server reports /limits',
	COMPUTE_CACHE_ERRORED_SOLVES: 'removed'
};

/**
 * The manifest for this deployment: engine and app keys, plus the slices of
 * the providers it selects. A provider's required keys only apply when it is
 * in use, so slices are chosen here rather than all composed at once.
 */
export function deploymentManifest(env: EnvRecord): Manifest {
	const chosen = new Set(
		(['SELVA_AUTH_PROVIDER', 'SELVA_DATA_PROVIDER', 'SELVA_STORAGE_PROVIDER'] as const).map((k) =>
			(env[k] ?? 'local').toLowerCase()
		)
	);
	return composeManifest([
		ENGINE_SETTINGS,
		APP_SETTINGS,
		...(chosen.has('local') ? [LOCAL_SETTINGS] : []),
		...(chosen.has('supabase') ? [SUPABASE_SETTINGS] : []),
		...(chosen.has('header') ? [HEADER_AUTH_SETTINGS] : [])
	]);
}

/** Every key any slice declares, whichever providers are chosen. */
export const ALL_SETTINGS: Manifest = composeManifest([
	ENGINE_SETTINGS,
	APP_SETTINGS,
	LOCAL_SETTINGS,
	SUPABASE_SETTINGS,
	HEADER_AUTH_SETTINGS
]);

/** The report for this deployment. Keys of providers it doesn't use are known, not typos. */
export function deploymentReport(env: EnvRecord): ConfigReport {
	const manifest = deploymentManifest(env);
	const active = new Set(manifest.flatMap((s) => [s.key, ...(s.aliases ?? [])]));
	const inactive = ALL_SETTINGS.flatMap((s) => [s.key, ...(s.aliases ?? [])]).filter(
		(k) => !active.has(k)
	);
	return buildConfigReport(manifest, env, {
		prefixes: WATCHED_PREFIXES,
		external: [...EXTERNAL_KEYS, ...Object.keys(RETIRED_KEYS), ...inactive]
	});
}

// Set by the process manager (pm2's ecosystem file), never by .env, so the CLI
// comparing .env with the last boot would report it as drift forever.
const NOT_FROM_ENV_FILE = new Set(['NODE_ENV']);

/** What the boot snapshot and the CLI's drift check compare. */
export function deploymentSnapshot(env: EnvRecord, salt?: string): ConfigSnapshot {
	const manifest = deploymentManifest(env).filter((s) => !NOT_FROM_ENV_FILE.has(s.key));
	return takeSnapshot(manifest, env, salt);
}

/** The rotation overlap of each root key: what the admin page and doctor count down. */
export function keyRotationStatus(env: EnvRecord, now: number = Date.now()): KeyRotation[] {
	return (['SELVA_HMAC_KEY', 'SELVA_AT_REST_KEY'] as const).map((key) => {
		const p = previousKey(env, key, now);
		// The previous key itself never leaves the server.
		return {
			key,
			state: p.state,
			...('expires' in p ? { expires: p.expires } : {}),
			...('daysLeft' in p ? { daysLeft: p.daysLeft } : {})
		};
	});
}
