import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider
} from '@selvajs/local-provider';
import { HeaderAuthProvider } from '@selvajs/header-auth-provider';
import {
	SupabaseAuthProvider,
	SupabaseDataProvider,
	SupabaseStorageProvider
} from '@selvajs/supabase-provider';
import { resolveComputeLimits } from '@selvajs/server/compute';
import { resolveApiRateLimitConfig } from '@selvajs/server/api';
import { resolveSignInMaxAgeMs } from '@selvajs/server/http';
import { readSmtpConfig } from '@selvajs/server/notifications';
import { ALL_SETTINGS, EXTERNAL_KEYS } from '../settings.js';

// The manifest is only worth trusting if it lists every key the code reads.
// Each reader runs against an env that records what it touches; a key read but
// not declared would be invisible to `selva config show` and the admin page.

const KEY = 'ab'.repeat(32);

function recordingEnv(values: Record<string, string>) {
	const read = new Set<string>();
	const env = new Proxy(values, {
		get(target, prop) {
			if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]+$/.test(prop)) read.add(prop);
			return Reflect.get(target, prop);
		}
	}) as Record<string, string | undefined>;
	return { env, read };
}

const declared = new Set<string>([
	...ALL_SETTINGS.flatMap((s) => [s.key, ...(s.aliases ?? [])]),
	...EXTERNAL_KEYS
]);

const readers: Record<string, (env: Record<string, string | undefined>) => unknown> = {
	'local auth': (e) => LocalAuthProvider.fromEnv(e),
	'local data': (e) => LocalDataProvider.fromEnv(e),
	'local storage': (e) => LocalStorageProvider.fromEnv(e),
	'header auth': (e) => HeaderAuthProvider.fromEnv(e),
	'supabase auth': (e) => SupabaseAuthProvider.fromEnv(e),
	'supabase data': (e) => SupabaseDataProvider.fromEnv(e),
	'supabase storage': (e) => SupabaseStorageProvider.fromEnv(e),
	'compute limits': (e) => resolveComputeLimits(e),
	'API token rate limit': (e) => resolveApiRateLimitConfig(e),
	'sign-in max age': (e) => resolveSignInMaxAgeMs(e),
	smtp: (e) => readSmtpConfig(e)
};

describe('every env key a reader touches is declared', () => {
	const base = {
		DATA_PATH: mkdtempSync(join(tmpdir(), 'selva-declared-')),
		SELVA_HMAC_KEY: KEY,
		SELVA_AT_REST_KEY: KEY,
		SUPABASE_URL: 'http://127.0.0.1:54421',
		SUPABASE_ANON_KEY: 'anon',
		SUPABASE_SERVICE_ROLE_KEY: 'service',
		SMTP_HOST: 'smtp.example.com',
		SMTP_FROM: 'Selva <no-reply@example.com>'
	};

	for (const [name, read] of Object.entries(readers)) {
		it(name, () => {
			const { env, read: touched } = recordingEnv({ ...base });
			read(env);
			expect(touched.size).toBeGreaterThan(0);
			expect([...touched].filter((k) => !declared.has(k))).toEqual([]);
		});
	}
});
