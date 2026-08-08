// Checks that read only `.env` values — no filesystem, no network, no
// subprocesses. These decide whether a deployment is validly configured, so
// they run on every `selva doctor` regardless of which providers are in play.

import { RENAMED_ENV_VARS, REPLACED_ENV_VARS } from '../env.js';
import { green, red, yellow } from './result.js';

const HEX_64 = /^[0-9a-f]{64}$/i;
const PLACEHOLDER = 'replace-this-with-a-random-32-byte-hex-key';

const VALID_AUTH = ['local', 'supabase', 'header'];
// Header-auth is an auth provider only — it has no data or storage layer.
const VALID_DATA = ['local', 'supabase'];

/**
 * Guards SELVA_HMAC_KEY and SELVA_AT_REST_KEY. A placeholder or short key
 * starts and serves traffic — the damage (forgeable sessions, weak at-rest
 * encryption) is invisible until someone looks for it.
 */
export function checkSecret(value, label) {
	if (!value) return red(`${label} — unset`);
	if (value === PLACEHOLDER) return red(`${label} — still the placeholder`);
	if (!HEX_64.test(value)) return red(`${label} — not 64 hex chars`);
	return green(label);
}

// Lowercased and defaulted the same way create-selva-providers.ts defaults them.
export function resolveProviders(env) {
	return {
		auth: (env.SELVA_AUTH_PROVIDER ?? 'local').toLowerCase(),
		data: (env.SELVA_DATA_PROVIDER ?? 'local').toLowerCase(),
		storage: (env.SELVA_STORAGE_PROVIDER ?? 'local').toLowerCase()
	};
}

export function checkProviders(providers) {
	const checks = [];
	if (!VALID_AUTH.includes(providers.auth)) {
		checks.push(red(`SELVA_AUTH_PROVIDER="${providers.auth}" — expected local|supabase|header`));
	}
	if (!VALID_DATA.includes(providers.data)) {
		checks.push(red(`SELVA_DATA_PROVIDER="${providers.data}" — expected local|supabase`));
	}
	if (!VALID_DATA.includes(providers.storage)) {
		checks.push(red(`SELVA_STORAGE_PROVIDER="${providers.storage}" — expected local|supabase`));
	}
	return checks;
}

export function checkTenancy(env) {
	const tenancy = (env.SELVA_TENANCY ?? 'single').toLowerCase();
	if (tenancy !== 'single' && tenancy !== 'multi') {
		return red(`SELVA_TENANCY="${tenancy}" — expected single|multi`);
	}
	return green(`SELVA_TENANCY=${tenancy}`);
}

export function checkOrigin(env) {
	if (!env.ORIGIN) return yellow('ORIGIN unset — required behind a reverse proxy');
	try {
		new URL(env.ORIGIN);
	} catch {
		return red(`ORIGIN="${env.ORIGIN}" is not a valid URL`);
	}
	return green(`ORIGIN=${env.ORIGIN}`);
}

// A rename is auto-fixable (`selva migrate` rewrites the key). A replacement
// encodes a value in the new name, so migrate leaves it alone rather than
// guessing — it's reported here and nowhere else.
export function checkDeprecatedEnv(env) {
	const checks = [];

	for (const [oldName, newName] of Object.entries(RENAMED_ENV_VARS)) {
		if (env[oldName] === undefined) continue;
		checks.push(
			env[newName] === undefined
				? yellow(`${oldName} is deprecated — \`selva migrate\` renames it to ${newName}`)
				: yellow(`${oldName} is deprecated and ignored — ${newName} is set and wins`)
		);
	}

	for (const [oldName, replacement] of Object.entries(REPLACED_ENV_VARS)) {
		if (env[oldName] === undefined) continue;
		checks.push(yellow(`${oldName} is deprecated — replace it with ${replacement}`));
	}

	return checks;
}
