import {
	buildConfigReport,
	composeManifest,
	previousKey,
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

/** Keys only this app reads. adapter-node's own keys are here too: they decide whether it works. */
export const APP_SETTINGS = composeManifest([
	defineSetting({
		key: 'ORIGIN',
		type: 'url',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Public URL of the app. Required behind a reverse proxy.',
		impact:
			'Wrong or unset behind a proxy: form posts fail the CSRF check and invite links carry an internal host.'
	}),
	defineSetting({
		key: 'PORT',
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
		type: 'string',
		default: '0.0.0.0',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Address the app binds to. 127.0.0.1 behind a proxy.',
		impact: 'Under header auth, anything that reaches the port directly can claim to be any user.'
	}),
	defineSetting({
		key: 'BODY_SIZE_LIMIT',
		type: 'string',
		default: '512K',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Largest request body adapter-node accepts (K, M or G suffix).',
		impact: 'Below COMPUTE_REQUEST_MAX_BYTES, uploads and file inputs fail with 413.'
	}),
	defineSetting({
		key: 'ADDRESS_HEADER',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Header carrying the client IP behind a proxy (X-Forwarded-For).',
		impact: 'Unset behind a proxy: every client shares one rate-limit bucket.'
	}),
	defineSetting({
		key: 'XFF_DEPTH',
		type: 'int',
		min: 1,
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Number of proxies in front of the app.'
	}),
	defineSetting({
		key: 'PROTOCOL_HEADER',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Header carrying the original protocol, when ORIGIN is unset.'
	}),
	defineSetting({
		key: 'HOST_HEADER',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Header carrying the original host, when ORIGIN is unset.'
	}),
	defineSetting({
		key: 'NODE_ENV',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'production in deployments: hides stack traces and makes cookies Secure.'
	}),
	defineSetting({
		key: 'ALLOW_INSECURE_COOKIES',
		type: 'bool',
		default: false,
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Drop the Secure cookie flag so sign-in works over plain http.',
		legacy: { bool: 'exact-true' }
	}),
	defineSetting({
		key: 'INSTALL_DIR',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description:
			'Deployment directory the admin updater runs in. Defaults to the working directory.'
	}),
	defineSetting({
		key: 'SELVA_EVENT_CALLBACK_ORIGIN',
		type: 'url',
		onInvalid: 'fail',
		class: 'bootstrap',
		description:
			'Origin Rhino.Compute posts live solve events to, when it differs from the browser’s.'
	}),
	defineSetting({
		key: 'MCP_ALLOWED_ORIGINS',
		type: 'list',
		default: [],
		onInvalid: 'fail',
		class: 'setting',
		description: 'Browser origins /mcp accepts besides its own.'
	}),
	defineSetting({
		key: 'LOG_LEVEL',
		type: 'enum',
		values: ['debug', 'info', 'warn', 'error'],
		onInvalid: 'default',
		class: 'setting',
		description: 'Lowest severity written to the log. Default info (debug in development).'
	}),
	defineSetting({
		key: 'SELVA_FLAG_COMPUTE_DEBUG',
		type: 'string',
		default: 'off',
		onInvalid: 'default',
		class: 'setting',
		description:
			'off, on (cache and timing lines per solve) or verbose (adds Compute’s raw error bodies).',
		impact: 'verbose can write what was solved to the log, which erasure cannot reach.'
	}),
	defineSetting({
		key: 'SELVA_FLAG_COMPUTE_DEBUG_VERBOSE',
		type: 'bool',
		onInvalid: 'default',
		class: 'setting',
		description: 'Replaced by SELVA_FLAG_COMPUTE_DEBUG=verbose.'
	}),
	defineSetting({
		key: 'SENTRY_DSN',
		type: 'url',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'Ship unexpected server errors to Sentry.'
	}),
	defineSetting({
		key: 'SELVA_RELEASE',
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
		external: [...EXTERNAL_KEYS, ...inactive]
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
