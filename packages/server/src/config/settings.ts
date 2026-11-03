import { composeManifest, defineSetting, type IntSetting } from '@selvajs/platform/config';
import { DEFAULT_API_RATE_LIMIT } from '../api/rate-limit.js';

// Keys the engine reads, wherever the host app runs it. Providers declare their
// own (`@selvajs/*-provider/config`); the host app declares what only it reads.

const flag = (key: string, description: string, impact?: string) =>
	defineSetting({
		key: `SELVA_FLAG_${key}`,
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
	description: string,
	extra: Partial<Pick<IntSetting, 'min' | 'aliases' | 'impact'>> = {}
) =>
	defineSetting({
		key,
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
	...(['AUTH', 'DATA', 'STORAGE'] as const).map((slot) =>
		defineSetting({
			key: `SELVA_${slot}_PROVIDER`,
			type: 'string',
			default: 'local',
			onInvalid: 'fail',
			class: 'bootstrap',
			summary: true,
			description: `${slot.toLowerCase()} provider: local, supabase${slot === 'AUTH' ? ' or header' : ''}.`,
			impact:
				'Switching it does not move any data: the instance starts on what the new provider holds.'
		})
	),
	defineSetting({
		key: 'SELVA_TENANCY',
		type: 'enum',
		values: ['single', 'multi'],
		default: 'single',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'single: one org per deployment. multi: users create their own orgs.'
	}),
	defineSetting({
		key: 'SELVA_CONFIG_PATH',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'A selva.config.js that replaces env-driven provider wiring.'
	}),

	// ── Keys ─────────────────────────────────────────────────────────────────
	defineSetting({
		key: 'SELVA_HMAC_KEY',
		type: 'string',
		minLength: 32,
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description: 'Signs sessions (local auth), OAuth codes, MCP client ids and solve-event tokens.',
		impact:
			'Changing it without SELVA_HMAC_KEY_PREVIOUS breaks what it signed: run `selva keys rotate hmac`.'
	}),
	defineSetting({
		key: 'SELVA_AT_REST_KEY',
		type: 'key',
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description: 'Encrypts stored Rhino.Compute API keys.',
		impact:
			'Changing it without SELVA_AT_REST_KEY_PREVIOUS makes stored API keys unreadable: run `selva keys rotate at-rest`.'
	}),

	defineSetting({
		key: 'SELVA_HMAC_KEY_PREVIOUS',
		type: 'string',
		minLength: 32,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description: 'The HMAC key before the last rotation. Still accepted for what it signed.',
		impact: 'Removing it ends sessions, MCP clients and links signed before the rotation.'
	}),
	defineSetting({
		key: 'SELVA_AT_REST_KEY_PREVIOUS',
		type: 'key',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description:
			'The encryption key before the last rotation. Stored API keys are re-sealed at boot.',
		impact: 'Remove it only once /admin/system shows no API key on the previous key.'
	}),

	defineSetting({
		key: 'SELVA_HMAC_KEY_PREVIOUS_EXPIRES',
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
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		sensitive: true,
		summary: true,
		description:
			'Only this address may claim instance admin while none exists. Break-glass recovery.'
	}),
	defineSetting({
		key: 'SIGN_IN_MAX_AGE_DAYS',
		type: 'int',
		min: 0,
		default: 0,
		onInvalid: 'fail',
		class: 'setting',
		summary: true,
		description: 'How long one sign-in at the identity provider lasts. 0 is off.',
		impact: 'API tokens of anyone who has not signed in within this many days are revoked.'
	}),
	flag('ALLOW_ORG_CREATION', 'Self-service org creation (read by host apps).'),
	flag(
		'ALLOW_CROSS_ORG_PUBLIC',
		'Public projects are visible to every signed-in user, not just the publishing org.',
		'Turning it on widens who sees existing public projects.'
	),
	flag('ALLOW_ORG_COMPUTE_OVERRIDE', 'Orgs may configure their own Rhino.Compute server.'),
	flag(
		'ENABLE_SHARING',
		'Per-definition share links for anonymous access.',
		'Turning it off stops every existing share link from resolving.'
	),
	flag(
		'ENABLE_PLATFORM_PROJECTS',
		'Projects owned by instance admins and granted to orgs or users.'
	),

	// ── Branding ─────────────────────────────────────────────────────────────
	...(
		[
			['NAME', 'Product name in the header and titles.'],
			['COPYRIGHT_NAME', 'Footer copyright owner. Defaults to the brand name.'],
			['TAGLINE', 'Subtitle on the landing page.'],
			['DESCRIPTION', 'Meta description for search and link previews.']
		] as const
	).map(([key, description]) =>
		defineSetting({
			key: `SELVA_BRAND_${key}`,
			type: 'string',
			onInvalid: 'fail',
			class: 'setting',
			description
		})
	),

	// ── Mail ─────────────────────────────────────────────────────────────────
	defineSetting({
		key: 'SMTP_HOST',
		type: 'string',
		onInvalid: 'fail',
		class: 'setting',
		description: 'SMTP server. Unset: invites return a link to send by hand.'
	}),
	defineSetting({
		key: 'SMTP_PORT',
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
		type: 'string',
		onInvalid: 'fail',
		class: 'setting',
		sensitive: true,
		description: 'SMTP login.'
	}),
	defineSetting({
		key: 'SMTP_PASS',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'SMTP password.'
	}),
	defineSetting({
		key: 'SMTP_FROM',
		type: 'string',
		onInvalid: 'fail',
		class: 'setting',
		sensitive: true,
		description: 'Sender address. Required once SMTP_HOST is set.'
	}),
	defineSetting({
		key: 'SMTP_SECURE',
		type: 'bool',
		onInvalid: 'fail',
		class: 'tunable',
		description: 'Override the TLS mode inferred from the port.',
		legacy: { bool: 'exact-true' }
	}),

	// ── Compute limits ───────────────────────────────────────────────────────
	tunableInt('COMPUTE_SOLVE_DEADLINE_MS', 100_000, 'Longest one solve may run.', {
		aliases: ['MAX_SOLVE_DURATION_MS'],
		impact: 'Past the reverse proxy read timeout, solves fail there with a 502 instead.'
	}),
	tunableInt('COMPUTE_RATE_LIMIT_WINDOW_MS', 100_000, 'Compute rate-limit window.'),
	tunableInt('COMPUTE_RATE_LIMIT_MAX', 120, 'Solves per user or share link per window.'),
	tunableInt('MAX_DEFINITION_FILE_SIZE_BYTES', 50 * MB, 'Largest .gh upload.'),
	tunableInt('MAX_IMAGE_FILE_SIZE_BYTES', 10 * MB, 'Largest cover image upload.'),
	tunableInt('COMPUTE_REQUEST_MAX_BYTES', 256 * MB, 'Largest solve request body.', {
		impact: 'Must stay at or below BODY_SIZE_LIMIT, or that limit rejects first.'
	}),
	tunableInt('COMPUTE_RESPONSE_MAX_BYTES', 300 * MB, 'Largest solve response body.'),
	tunableInt('REMOTE_DEFINITION_FETCH_TIMEOUT_MS', 30_000, 'Deadline for fetching a remote .gh.'),
	tunableInt(
		'REMOTE_DEFINITION_CACHE_TTL_MS',
		5 * 60 * 1000,
		'How long remote .gh bytes stay cached.',
		{
			aliases: ['DEFINITION_CACHE_TTL_MS']
		}
	),
	tunableInt(
		'COMPUTE_MAX_QUEUE_DEPTH',
		0,
		'Solves allowed to wait per compute server. 0 is unbounded.',
		{
			min: 0
		}
	),
	tunableInt('COMPUTE_QUEUE_WAIT_MS', 0, 'Longest a solve may wait queued. 0 is no deadline.', {
		min: 0
	}),
	tunableInt('COMPUTE_DEFINITION_CACHE_MB', 256, 'Definition cache budget. 0 turns it off.', {
		min: 0,
		aliases: ['COMPUTE_DEFINITION_BYTE_CACHE_MB']
	}),
	tunableInt(
		'COMPUTE_SOLVE_CACHE_MB',
		256,
		'Solve cache budget per warm compute server. 0 turns it off.',
		{
			min: 0,
			aliases: ['COMPUTE_RESPONSE_CACHE_MB']
		}
	),
	defineSetting({
		key: 'COMPUTE_REUSE_DEFINITION_CACHE',
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
		type: 'bool',
		default: true,
		onInvalid: 'default',
		class: 'tunable',
		description: 'Ask Rhino.Compute to cache solve results server-side.'
	}),
	tunableInt(
		'API_TOKEN_RATE_LIMIT_WINDOW_MS',
		DEFAULT_API_RATE_LIMIT.windowMs,
		'API token rate-limit window.'
	),
	tunableInt(
		'API_TOKEN_RATE_LIMIT_MAX',
		DEFAULT_API_RATE_LIMIT.maxPerWindow,
		'Requests per API token per window. 0 is off.',
		{
			min: 0
		}
	)
]);
