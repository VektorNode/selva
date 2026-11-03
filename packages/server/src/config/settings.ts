import { composeManifest, defineSetting, type IntSetting } from '@selvajs/platform/config';
import { DEFAULT_API_RATE_LIMIT } from '../api/rate-limit.js';

// Keys the engine reads, wherever the host app runs it. Providers declare their
// own (`@selvajs/*-provider/config`); the host app declares what only it reads.

const flag = (key: string, label: string, description: string, impact?: string) =>
	defineSetting({
		key: `SELVA_FLAG_${key}`,
		label,
		type: 'bool',
		default: false,
		onInvalid: 'fail',
		class: 'setting',
		description,
		...(impact ? { impact } : {})
	});

const tunableInt = (
	key: string,
	fallback: number,
	label: string,
	description: string,
	extra: Partial<Pick<IntSetting, 'min' | 'aliases' | 'impact' | 'zero' | 'unit'>> = {}
) =>
	defineSetting({
		key,
		label,
		type: 'int',
		min: 1,
		default: fallback,
		onInvalid: 'default',
		class: 'tunable',
		description,
		...extra
	});

const MB = 1024 * 1024;

export const ENGINE_SETTINGS = composeManifest([
	// ── Wiring ───────────────────────────────────────────────────────────────
	...(
		[
			[
				'AUTH',
				'Sign-in',
				'Who checks passwords: local (this server), supabase, or header (your SSO proxy).'
			],
			[
				'DATA',
				'Database',
				'Where users, orgs and projects live: local (files on this server) or supabase.'
			],
			[
				'STORAGE',
				'File storage',
				'Where uploaded .gh files and images live: local (this server) or supabase.'
			]
		] as const
	).map(([slot, label, description]) =>
		defineSetting({
			key: `SELVA_${slot}_PROVIDER`,
			label,
			type: 'string',
			default: 'local',
			onInvalid: 'fail',
			class: 'bootstrap',
			summary: true,
			description,
			impact:
				'Switching it does not move any data: the instance starts on what the new provider holds.'
		})
	),
	defineSetting({
		key: 'SELVA_TENANCY',
		label: 'Organizations',
		type: 'enum',
		values: ['single', 'multi'],
		default: 'single',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'single: everyone shares one organization. multi: users can create their own.'
	}),
	defineSetting({
		key: 'SELVA_CONFIG_PATH',
		label: 'Custom config file',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'A selva.config.js that replaces env-driven provider wiring.'
	}),

	// ── Keys ─────────────────────────────────────────────────────────────────
	defineSetting({
		key: 'SELVA_HMAC_KEY',
		label: 'Signing key',
		type: 'string',
		minLength: 32,
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description:
			'Stops sign-ins, links and tokens from being forged. Generated at install; never share it.',
		impact:
			'Changing it without SELVA_HMAC_KEY_PREVIOUS breaks what it signed: run `selva keys rotate hmac`.'
	}),
	defineSetting({
		key: 'SELVA_AT_REST_KEY',
		label: 'Encryption key',
		type: 'key',
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description: 'Encrypts the Rhino.Compute API keys stored here. Generated at install.',
		impact:
			'Changing it without SELVA_AT_REST_KEY_PREVIOUS makes stored API keys unreadable: run `selva keys rotate at-rest`.'
	}),

	defineSetting({
		key: 'SELVA_HMAC_KEY_PREVIOUS',
		label: 'Previous signing key',
		type: 'string',
		minLength: 32,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description: 'Kept after a rotation so what the old signing key signed works until it expires.',
		impact: 'Removing it ends sessions, MCP clients and links signed before the rotation.'
	}),
	defineSetting({
		key: 'SELVA_AT_REST_KEY_PREVIOUS',
		label: 'Previous encryption key',
		type: 'key',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description:
			'Kept after a rotation until stored API keys are re-encrypted, which happens at the next start.',
		impact: 'Remove it only once /admin/system shows no API key on the previous key.'
	}),

	defineSetting({
		key: 'SELVA_HMAC_KEY_PREVIOUS_EXPIRES',
		label: 'Previous signing key expiry',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		description:
			'When SELVA_HMAC_KEY_PREVIOUS stops being accepted (ISO date). Set by `selva keys rotate`.',
		impact:
			'After it, anything only the previous key opens is refused. An unreadable date counts as passed.'
	}),
	defineSetting({
		key: 'SELVA_AT_REST_KEY_PREVIOUS_EXPIRES',
		label: 'Previous encryption key expiry',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		description:
			'When SELVA_AT_REST_KEY_PREVIOUS stops being accepted (ISO date). Set by `selva keys rotate`.',
		impact:
			'After it, anything only the previous key opens is refused. An unreadable date counts as passed.'
	}),

	// ── Access ───────────────────────────────────────────────────────────────
	defineSetting({
		key: 'BOOTSTRAP_INSTANCE_ADMIN_EMAIL',
		label: 'Recovery admin email',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		sensitive: true,
		summary: true,
		description:
			'While no instance admin exists, only this address may become one. For first setup and lockouts.'
	}),
	defineSetting({
		key: 'SIGN_IN_MAX_AGE_DAYS',
		label: 'Force sign-in again after',
		type: 'int',
		min: 0,
		default: 0,
		onInvalid: 'fail',
		class: 'setting',
		summary: true,
		zero: 'Never',
		unit: 'days',
		description: 'Days before users must sign in at the identity provider again. 0 is never.',
		impact: 'API tokens of anyone who has not signed in within this many days are revoked.'
	}),
	flag('ALLOW_ORG_CREATION', 'Users create orgs', 'Self-service org creation (read by host apps).'),
	flag(
		'ALLOW_CROSS_ORG_PUBLIC',
		'Public across orgs',
		'Public projects are visible to every signed-in user, not just the publishing org.',
		'Turning it on widens who sees existing public projects.'
	),
	flag(
		'ALLOW_ORG_COMPUTE_OVERRIDE',
		'Orgs bring their own compute',
		'Orgs may configure their own Rhino.Compute server.'
	),
	flag(
		'ENABLE_SHARING',
		'Share links',
		'Per-definition share links for anonymous access.',
		'Turning it off stops every existing share link from resolving.'
	),
	flag(
		'ENABLE_PLATFORM_PROJECTS',
		'Platform projects',
		'Projects owned by instance admins and granted to orgs or users.'
	),

	// ── Branding ─────────────────────────────────────────────────────────────
	...(
		[
			['NAME', 'Product name', 'Product name in the header and titles.'],
			['COPYRIGHT_NAME', 'Copyright holder', 'Footer copyright owner. Defaults to the brand name.'],
			['TAGLINE', 'Tagline', 'Subtitle on the landing page.'],
			['DESCRIPTION', 'Site description', 'Meta description for search and link previews.']
		] as const
	).map(([key, label, description]) =>
		defineSetting({
			key: `SELVA_BRAND_${key}`,
			label,
			type: 'string',
			onInvalid: 'fail',
			class: 'setting',
			description
		})
	),

	// ── Mail ─────────────────────────────────────────────────────────────────
	defineSetting({
		key: 'SMTP_HOST',
		label: 'Mail server',
		type: 'string',
		onInvalid: 'fail',
		class: 'setting',
		description: 'SMTP server. Unset: invites return a link to send by hand.'
	}),
	defineSetting({
		key: 'SMTP_PORT',
		label: 'Mail server port',
		type: 'int',
		min: 1,
		max: 65535,
		default: 587,
		onInvalid: 'fail',
		class: 'setting',
		description: '587 for STARTTLS, 465 for implicit TLS.'
	}),
	defineSetting({
		key: 'SMTP_USER',
		label: 'Mail username',
		type: 'string',
		onInvalid: 'fail',
		class: 'setting',
		sensitive: true,
		description: 'SMTP login.'
	}),
	defineSetting({
		key: 'SMTP_PASS',
		label: 'Mail password',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'SMTP password.'
	}),
	defineSetting({
		key: 'SMTP_FROM',
		label: 'Sender address',
		type: 'string',
		onInvalid: 'fail',
		class: 'setting',
		sensitive: true,
		description: 'Sender address. Required once SMTP_HOST is set.'
	}),
	defineSetting({
		key: 'SMTP_SECURE',
		label: 'Mail TLS mode',
		type: 'bool',
		onInvalid: 'fail',
		class: 'tunable',
		description: 'Override the TLS mode inferred from the port.',
		legacy: { bool: 'exact-true' }
	}),

	// ── Compute limits ───────────────────────────────────────────────────────
	tunableInt(
		'COMPUTE_SOLVE_DEADLINE_MS',
		100_000,
		'Solve time limit',
		'Longest one solve may run.',
		{
			unit: 'ms',
			aliases: ['MAX_SOLVE_DURATION_MS'],
			impact: 'Past the reverse proxy read timeout, solves fail there with a 502 instead.'
		}
	),
	tunableInt(
		'COMPUTE_RATE_LIMIT_WINDOW_MS',
		100_000,
		'Solve rate limit window',
		'Compute rate-limit window.',
		{ unit: 'ms' }
	),
	tunableInt(
		'COMPUTE_RATE_LIMIT_MAX',
		120,
		'Solves per window',
		'Solves per user or share link per window.'
	),
	tunableInt('MAX_DEFINITION_FILE_SIZE_BYTES', 50 * MB, 'Max .gh upload', 'Largest .gh upload.', {
		unit: 'bytes'
	}),
	tunableInt(
		'MAX_IMAGE_FILE_SIZE_BYTES',
		10 * MB,
		'Max image upload',
		'Largest cover image upload.',
		{ unit: 'bytes' }
	),
	tunableInt(
		'COMPUTE_REQUEST_MAX_BYTES',
		256 * MB,
		'Max solve request',
		'Largest solve request body.',
		{
			unit: 'bytes',
			impact: 'Must stay at or below BODY_SIZE_LIMIT, or that limit rejects first.'
		}
	),
	tunableInt(
		'COMPUTE_RESPONSE_MAX_BYTES',
		300 * MB,
		'Max solve response',
		'Largest solve response body.',
		{ unit: 'bytes' }
	),
	tunableInt(
		'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
		30_000,
		'Remote .gh fetch timeout',
		'Deadline for fetching a remote .gh.',
		{ unit: 'ms' }
	),
	tunableInt(
		'REMOTE_DEFINITION_CACHE_TTL_MS',
		5 * 60 * 1000,
		'Remote .gh cache time',
		'How long remote .gh bytes stay cached.',
		{ unit: 'ms', aliases: ['DEFINITION_CACHE_TTL_MS'] }
	),
	tunableInt(
		'COMPUTE_MAX_QUEUE_DEPTH',
		0,
		'Solve queue length',
		'Solves allowed to wait per compute server. 0 is unbounded.',
		{ min: 0, zero: 'No limit' }
	),
	tunableInt(
		'COMPUTE_QUEUE_WAIT_MS',
		0,
		'Max queue wait',
		'Longest a solve may wait queued. 0 is no deadline.',
		{ min: 0, unit: 'ms', zero: 'No limit' }
	),
	tunableInt(
		'COMPUTE_DEFINITION_CACHE_MB',
		256,
		'Definition cache size',
		'Definition cache budget. 0 turns it off.',
		{ min: 0, unit: 'mb', zero: 'Off', aliases: ['COMPUTE_DEFINITION_BYTE_CACHE_MB'] }
	),
	tunableInt(
		'COMPUTE_SOLVE_CACHE_MB',
		256,
		'Solve cache size',
		'Solve cache budget per warm compute server. 0 turns it off.',
		{ min: 0, unit: 'mb', zero: 'Off', aliases: ['COMPUTE_RESPONSE_CACHE_MB'] }
	),
	defineSetting({
		key: 'COMPUTE_REUSE_DEFINITION_CACHE',
		label: 'Reuse compute server definition cache',
		type: 'bool',
		default: true,
		onInvalid: 'default',
		class: 'tunable',
		description: 'Reuse the compute server’s cached definition instead of re-uploading it.',
		impact:
			'Leave on only with a compute server that reports a stale pointer (the VektorNode fork).'
	}),
	defineSetting({
		key: 'COMPUTE_SERVER_CACHESOLVE',
		label: 'Compute server solve cache',
		type: 'bool',
		default: true,
		onInvalid: 'default',
		class: 'tunable',
		description: 'Ask Rhino.Compute to cache solve results server-side.'
	}),
	tunableInt(
		'API_TOKEN_RATE_LIMIT_WINDOW_MS',
		DEFAULT_API_RATE_LIMIT.windowMs,
		'API rate limit window',
		'API token rate-limit window.',
		{ unit: 'ms' }
	),
	tunableInt(
		'API_TOKEN_RATE_LIMIT_MAX',
		DEFAULT_API_RATE_LIMIT.maxPerWindow,
		'API requests per window',
		'Requests per API token per window. 0 is off.',
		{ min: 0, zero: 'Off' }
	)
]);
