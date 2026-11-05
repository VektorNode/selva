import {
	composeManifest,
	defineSetting,
	resolveConfig,
	type EnvRecord
} from '@selvajs/platform/config';

export const SUPABASE_SETTINGS = composeManifest([
	defineSetting({
		key: 'SUPABASE_URL',
		label: 'Supabase project',
		type: 'url',
		required: true,
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Supabase project URL.',
		impact: 'Pointing it at another project shows that project’s users and data.'
	}),
	defineSetting({
		key: 'SUPABASE_ANON_KEY',
		label: 'Supabase publishable key',
		type: 'string',
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		description: 'Publishable key (sb_publishable_…).'
	}),
	defineSetting({
		key: 'SUPABASE_SERVICE_ROLE_KEY',
		label: 'Supabase secret key',
		type: 'string',
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'Secret key (sb_secret_…). Bypasses row security: server only.'
	}),
	defineSetting({
		key: 'SUPABASE_JWT_SIGNING_KEY',
		label: 'Supabase JWT signing key',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'Private ES256 JWK, one line. Needed for API tokens.',
		impact: 'Without it, or SUPABASE_JWT_SECRET, API tokens answer 503.'
	}),
	defineSetting({
		key: 'SUPABASE_JWT_SECRET',
		label: 'Supabase JWT secret (legacy)',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'Legacy HS256 JWT secret. Used only without SUPABASE_JWT_SIGNING_KEY.'
	}),
	defineSetting({
		key: 'SUPABASE_ENABLE_SELF_SIGNUP',
		label: 'Self sign-up',
		type: 'bool',
		default: false,
		onInvalid: 'fail',
		class: 'setting',
		description: 'Allow self-service sign-up at /signup.',
		legacy: { bool: 'exact-true' }
	}),
	defineSetting({
		key: 'SUPABASE_ALLOW_EMAIL_LINK_SIGNUP',
		label: 'Sign-up by email link',
		type: 'bool',
		default: true,
		onInvalid: 'fail',
		class: 'setting',
		description: 'A magic link to an unknown address creates an account.',
		legacy: { bool: 'not-false' }
	}),
	defineSetting({
		key: 'SUPABASE_OAUTH_PROVIDERS',
		label: 'OAuth sign-in buttons',
		type: 'list',
		default: [],
		onInvalid: 'fail',
		class: 'setting',
		description: 'OAuth buttons on the login page (google, github, azure, gitlab).'
	}),
	defineSetting({
		key: 'SUPABASE_PUBLIC_BUCKET',
		label: 'Public files bucket',
		type: 'string',
		default: 'selva-public',
		onInvalid: 'fail',
		class: 'tunable',
		description: 'Storage bucket for public files.'
	}),
	defineSetting({
		key: 'SUPABASE_PRIVATE_BUCKET',
		label: 'Private files bucket',
		type: 'string',
		default: 'selva-private',
		onInvalid: 'fail',
		class: 'tunable',
		description: 'Storage bucket for private files.'
	})
]);

/** Resolve this provider's keys, throwing on the first fail-closed error. */
export function resolveSupabaseEnv(env: EnvRecord): Record<string, unknown> {
	const { values, errors } = resolveConfig(SUPABASE_SETTINGS, env);
	if (errors.length > 0) {
		const e = errors[0];
		throw new Error(
			e.problem === 'is required' ? `Missing required env var: ${e.key}` : `${e.key} ${e.problem}.`
		);
	}
	return values;
}
