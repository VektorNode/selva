// The provider per slot for `pnpm dev:<auth>` and `pnpm run stage <auth>`:
//
//   --data local|supabase  --storage local|supabase  --tenancy single|multi
//
// Unset, data and storage follow the auth provider (header has none of its own, so local),
// and tenancy is single: the shapes those commands always ran.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const AUTH = ['local', 'supabase', 'header'];
const BACKENDS = ['local', 'supabase'];
const TENANCIES = ['single', 'multi'];

function option(argv, name, allowed, fallback) {
	const at = argv.indexOf(`--${name}`);
	if (at === -1) return fallback;
	const value = argv[at + 1];
	if (!allowed.includes(value)) {
		throw new Error(`--${name} takes ${allowed.join(' | ')}, got "${value ?? ''}".`);
	}
	return value;
}

/** Throws on an unknown value, so a typo never boots a shape nobody asked for. */
export function parseMix(auth, argv) {
	if (!AUTH.includes(auth)) throw new Error(`Auth provider is ${AUTH.join(' | ')}, got "${auth}".`);
	const backend = auth === 'header' ? 'local' : auth;
	return {
		auth,
		data: option(argv, 'data', BACKENDS, backend),
		storage: option(argv, 'storage', BACKENDS, backend),
		tenancy: option(argv, 'tenancy', TENANCIES, 'single')
	};
}

export function usesSupabase(mix) {
	return mix.auth === 'supabase' || mix.data === 'supabase' || mix.storage === 'supabase';
}

/** `header`, or `header+data-supabase+multi` when a slot differs from its default. */
export function mixLabel(mix) {
	const plain = parseMix(mix.auth, []);
	const parts = [mix.auth];
	if (mix.data !== plain.data) parts.push(`data-${mix.data}`);
	if (mix.storage !== plain.storage) parts.push(`storage-${mix.storage}`);
	if (mix.tenancy !== plain.tenancy) parts.push(mix.tenancy);
	return parts.join('+');
}

export function parseEnv(text) {
	const out = {};
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) out[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
	}
	return out;
}

/** The `SUPABASE_*` settings for the local Supabase CLI stack, from `.env.dev-supabase`. */
export function supabaseEnv() {
	const env = parseEnv(
		fs.readFileSync(path.join(rootDir, 'packages', 'selva', '.env.dev-supabase'), 'utf8')
	);
	return Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('SUPABASE_')));
}

export function mixEnv(mix) {
	return {
		SELVA_AUTH_PROVIDER: mix.auth,
		SELVA_DATA_PROVIDER: mix.data,
		SELVA_STORAGE_PROVIDER: mix.storage,
		SELVA_TENANCY: mix.tenancy
	};
}
