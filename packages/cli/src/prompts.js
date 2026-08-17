// Shared prompt flow for create and init; differs only in defaults and output.

import * as p from '@clack/prompts';
import pc from 'picocolors';

const TRUTHY = new Set(['true', '1', 'yes']);

// Mirrors FLAG_KEYS in @selvajs/server's create-selva-providers.ts. Every key
// here is written to .env; `promptable: false` only hides it from the wizard.
const FLAG_OPTIONS = [
	{
		value: 'ALLOW_ORG_CREATION',
		label: 'Allow non-admin users to create their own orgs',
		hint: 'multi-tenant self-service',
		multiOnly: true,
		// No route consults this flag yet — self-service org creation has not
		// shipped. Offering it would promise behaviour nothing implements.
		promptable: false
	},
	{
		value: 'ALLOW_CROSS_ORG_PUBLIC',
		label: 'Public projects visible across all orgs',
		hint: 'instance-wide discovery',
		multiOnly: true
	},
	{
		value: 'ALLOW_ORG_COMPUTE_OVERRIDE',
		label: 'Orgs can configure their own Rhino.Compute server',
		hint: 'BYO compute',
		multiOnly: true
	},
	{
		value: 'ENABLE_PLATFORM_PROJECTS',
		label: 'Platform projects (admin-owned, granted to orgs/users)',
		hint: 'cross-org sharing without membership'
	},
	{
		value: 'ENABLE_SHARING',
		label: 'Per-definition share links (anonymous external access)',
		hint: 'tokenized URLs'
	}
];

const FLAG_NAMES = FLAG_OPTIONS.map((o) => o.value);

/**
 * Flags worth offering for a given tenancy. Cross-org flags are hidden under
 * `single`, where one org makes both settings describe the same set.
 */
export function promptableFlags(tenancy) {
	return FLAG_OPTIONS.filter((o) => o.promptable !== false && (tenancy === 'multi' || !o.multiOnly));
}

function envBool(v) {
	if (v === undefined) return false;
	return TRUTHY.has(String(v).toLowerCase());
}

export function collectConfigFromEnv(env = process.env) {
	const tenancy = pick(env.SELVA_TENANCY, ['single', 'multi'], 'single', 'SELVA_TENANCY');
	const auth = pick(
		env.SELVA_AUTH_PROVIDER,
		['local', 'supabase', 'header'],
		'local',
		'SELVA_AUTH_PROVIDER'
	);
	// Header-auth has no data layer, so it falls through to local unless overridden.
	const dataDefault = auth === 'header' ? 'local' : auth;
	const data = pick(
		env.SELVA_DATA_PROVIDER,
		['local', 'supabase'],
		dataDefault,
		'SELVA_DATA_PROVIDER'
	);
	const storage = pick(
		env.SELVA_STORAGE_PROVIDER,
		['local', 'supabase'],
		dataDefault,
		'SELVA_STORAGE_PROVIDER'
	);

	const values = {
		SELVA_TENANCY: tenancy,
		SELVA_AUTH_PROVIDER: auth,
		SELVA_DATA_PROVIDER: data,
		SELVA_STORAGE_PROVIDER: storage
	};

	if (auth === 'local' || data === 'local' || storage === 'local') {
		values.DATA_PATH = env.DATA_PATH || './.selva-data';
	}

	if (auth === 'supabase' || data === 'supabase' || storage === 'supabase') {
		const url = requireEnv(env, 'SUPABASE_URL');
		try {
			new URL(url);
		} catch {
			throw new Error('SUPABASE_URL must be a valid URL.');
		}
		values.SUPABASE_URL = url;
		values.SUPABASE_ANON_KEY = requireEnv(env, 'SUPABASE_ANON_KEY');
		values.SUPABASE_SERVICE_ROLE_KEY = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
	}

	if (auth === 'header') {
		values.HOST = env.HOST || '127.0.0.1';
		if (data !== 'local') {
			values.HEADER_AUTH_DATA_DIR = requireEnv(env, 'HEADER_AUTH_DATA_DIR');
		} else if (env.HEADER_AUTH_DATA_DIR) {
			values.HEADER_AUTH_DATA_DIR = env.HEADER_AUTH_DATA_DIR;
		}
		if (env.HEADER_AUTH_UPN_HEADER) values.HEADER_AUTH_UPN_HEADER = env.HEADER_AUTH_UPN_HEADER;
		if (env.HEADER_AUTH_EMAIL_HEADER)
			values.HEADER_AUTH_EMAIL_HEADER = env.HEADER_AUTH_EMAIL_HEADER;
		if (env.HEADER_AUTH_DISPLAY_NAME_HEADER)
			values.HEADER_AUTH_DISPLAY_NAME_HEADER = env.HEADER_AUTH_DISPLAY_NAME_HEADER;
	}

	const adminRequired = auth === 'header' || tenancy === 'multi';
	const adminEmail = env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL || '';
	if (adminRequired && !adminEmail) {
		throw new Error(
			`BOOTSTRAP_INSTANCE_ADMIN_EMAIL is required for ${auth === 'header' ? 'header-auth' : 'multi-tenant'} deployments.`
		);
	}
	if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
		throw new Error('BOOTSTRAP_INSTANCE_ADMIN_EMAIL is not a valid email.');
	}
	values.BOOTSTRAP_INSTANCE_ADMIN_EMAIL = adminEmail;

	const origin = env.ORIGIN || '';
	if (origin) {
		try {
			new URL(origin);
		} catch {
			throw new Error('ORIGIN must be a valid URL.');
		}
		if (origin.endsWith('/')) {
			throw new Error('ORIGIN must not have a trailing slash.');
		}
	}
	values.ORIGIN = origin;

	// An explicitly-set flag is preserved verbatim even when tenancy makes it
	// inert: rewriting it to '' would hide the operator's misconfiguration
	// rather than fix it, and the server already reads every key as opt-in.
	for (const f of FLAG_NAMES) {
		const key = `SELVA_FLAG_${f}`;
		values[key] = envBool(env[key]) ? 'true' : '';
	}

	return values;
}

function pick(value, allowed, fallback, name) {
	if (!value) return fallback;
	if (!allowed.includes(value)) {
		throw new Error(`${name} must be one of: ${allowed.join(', ')} (got "${value}").`);
	}
	return value;
}

function requireEnv(env, name) {
	const v = env[name];
	if (!v) throw new Error(`${name} is required.`);
	return v;
}

export async function collectConfig({ defaults = {}, mode = 'create' } = {}) {
	const isInit = mode === 'init';

	p.intro(pc.bgCyan(pc.black(isInit ? ' selva init ' : ' Selva — new deployment ')));

	const tenancy = await p.select({
		message: 'Tenancy mode',
		initialValue: defaults.SELVA_TENANCY ?? 'single',
		options: [
			{
				value: 'single',
				label: 'single',
				hint: 'one org per deployment (white-label)'
			},
			{
				value: 'multi',
				label: 'multi',
				hint: 'orgs are first-class (SaaS-style)'
			}
		]
	});
	cancelOn(tenancy);

	const auth = await p.select({
		message: 'Auth backend',
		initialValue: defaults.SELVA_AUTH_PROVIDER ?? 'local',
		options: [
			{ value: 'local', label: 'local', hint: 'filesystem + HMAC sessions' },
			{ value: 'supabase', label: 'supabase', hint: 'managed auth + Postgres + storage' },
			{
				value: 'header',
				label: 'header',
				hint: 'forward-auth via reverse proxy (Entra, oauth2-proxy, …)'
			}
		]
	});
	cancelOn(auth);

	let data;
	let storage;
	if (auth === 'header') {
		p.note(headerAuthSecurityWarning(), pc.yellow('⚠ Read before deploying'));

		const dataChoice = await p.select({
			message: 'Data backend (header-auth has none — pair with local or supabase)',
			initialValue: defaults.SELVA_DATA_PROVIDER ?? 'local',
			options: [
				{ value: 'local', label: 'local', hint: 'filesystem JSON' },
				{ value: 'supabase', label: 'supabase', hint: 'Postgres' }
			]
		});
		cancelOn(dataChoice);
		data = dataChoice;

		const storageChoice = await p.select({
			message: 'Storage backend',
			initialValue: defaults.SELVA_STORAGE_PROVIDER ?? data,
			options: [
				{ value: 'local', label: 'local', hint: 'filesystem' },
				{ value: 'supabase', label: 'supabase', hint: 'Supabase Storage' }
			]
		});
		cancelOn(storageChoice);
		storage = storageChoice;
	} else {
		const mixProviders = await p.confirm({
			message: `Use ${pc.cyan(auth)} for data and storage too?`,
			initialValue: pickSameProviderDefault(defaults, auth)
		});
		cancelOn(mixProviders);

		data = auth;
		storage = auth;
		if (!mixProviders) {
			const dataChoice = await p.select({
				message: 'Data backend',
				initialValue: defaults.SELVA_DATA_PROVIDER ?? auth,
				options: [
					{ value: 'local', label: 'local' },
					{ value: 'supabase', label: 'supabase' }
				]
			});
			cancelOn(dataChoice);
			data = dataChoice;

			const storageChoice = await p.select({
				message: 'Storage backend',
				initialValue: defaults.SELVA_STORAGE_PROVIDER ?? auth,
				options: [
					{ value: 'local', label: 'local' },
					{ value: 'supabase', label: 'supabase' }
				]
			});
			cancelOn(storageChoice);
			storage = storageChoice;
		}
	}

	const providerValues = {};
	if (auth === 'local' || data === 'local' || storage === 'local') {
		const dataPath = await p.text({
			message: 'DATA_PATH — directory for users/orgs JSON + uploaded .gh files',
			placeholder: './.selva-data',
			initialValue: defaults.DATA_PATH ?? './.selva-data'
		});
		cancelOn(dataPath);
		providerValues.DATA_PATH = String(dataPath);
	}

	if (auth === 'supabase' || data === 'supabase' || storage === 'supabase') {
		const supabaseUrl = await p.text({
			message: 'SUPABASE_URL',
			placeholder: 'https://<project-ref>.supabase.co',
			initialValue: defaults.SUPABASE_URL ?? '',
			validate: (v) => {
				if (!v) return 'Required for the Supabase provider.';
				try {
					new URL(v);
				} catch {
					return 'Must be a valid URL.';
				}
				return undefined;
			}
		});
		cancelOn(supabaseUrl);

		const supabaseAnon = await p.text({
			message: 'SUPABASE_ANON_KEY (publishable)',
			placeholder: 'sb_publishable_…',
			initialValue: defaults.SUPABASE_ANON_KEY ?? '',
			validate: (v) => (v ? undefined : 'Required.')
		});
		cancelOn(supabaseAnon);

		const supabaseService = await p.password({
			message: 'SUPABASE_SERVICE_ROLE_KEY (secret, server-only)',
			validate: (v) => (v || defaults.SUPABASE_SERVICE_ROLE_KEY ? undefined : 'Required.')
		});
		cancelOn(supabaseService);

		providerValues.SUPABASE_URL = String(supabaseUrl);
		providerValues.SUPABASE_ANON_KEY = String(supabaseAnon);
		providerValues.SUPABASE_SERVICE_ROLE_KEY = String(
			supabaseService || defaults.SUPABASE_SERVICE_ROLE_KEY || ''
		);
	}

	if (auth === 'header') {
		if (data !== 'local') {
			const dataDir = await p.text({
				message: 'HEADER_AUTH_DATA_DIR — directory for header-allowlist.json',
				placeholder: './.selva-data',
				initialValue: defaults.HEADER_AUTH_DATA_DIR ?? './.selva-data',
				validate: (v) => (v ? undefined : 'Required when data provider is not local.')
			});
			cancelOn(dataDir);
			providerValues.HEADER_AUTH_DATA_DIR = String(dataDir);
		} else if (defaults.HEADER_AUTH_DATA_DIR) {
			providerValues.HEADER_AUTH_DATA_DIR = defaults.HEADER_AUTH_DATA_DIR;
		}

		const customizeHeaders = await p.confirm({
			message: 'Customize the trusted header names?',
			initialValue: Boolean(
				defaults.HEADER_AUTH_UPN_HEADER ||
				defaults.HEADER_AUTH_EMAIL_HEADER ||
				defaults.HEADER_AUTH_DISPLAY_NAME_HEADER
			)
		});
		cancelOn(customizeHeaders);

		if (customizeHeaders) {
			const upn = await p.text({
				message: 'HEADER_AUTH_UPN_HEADER',
				placeholder: 'SELVA-UserPrincipalName',
				initialValue: defaults.HEADER_AUTH_UPN_HEADER ?? ''
			});
			cancelOn(upn);
			const email = await p.text({
				message: 'HEADER_AUTH_EMAIL_HEADER',
				placeholder: 'SELVA-Email',
				initialValue: defaults.HEADER_AUTH_EMAIL_HEADER ?? ''
			});
			cancelOn(email);
			const display = await p.text({
				message: 'HEADER_AUTH_DISPLAY_NAME_HEADER',
				placeholder: 'SELVA-DisplayName',
				initialValue: defaults.HEADER_AUTH_DISPLAY_NAME_HEADER ?? ''
			});
			cancelOn(display);

			providerValues.HEADER_AUTH_UPN_HEADER = stringValue(upn);
			providerValues.HEADER_AUTH_EMAIL_HEADER = stringValue(email);
			providerValues.HEADER_AUTH_DISPLAY_NAME_HEADER = stringValue(display);
		}

		// Not enforced — a Docker network can still route to the container on another host.
		const bindLoopback = await p.confirm({
			message: 'Bind the app to 127.0.0.1 only? (recommended for header-auth)',
			initialValue: !defaults.HOST || defaults.HOST === '127.0.0.1' || defaults.HOST === 'localhost'
		});
		cancelOn(bindLoopback);
		providerValues.HOST = bindLoopback ? '127.0.0.1' : stringValue(defaults.HOST);
	}

	if (auth === 'header') {
		p.note(
			[
				'Header-auth has no /setup form. The first proxy-authenticated visit whose',
				'email matches this var becomes ' +
					pc.bold('instance admin') +
					' automatically. Set it now so you',
				'can claim admin on first visit — otherwise you will need to hand-edit JSON',
				'files on the server to bootstrap.',
				'',
				pc.dim('Only consulted while no admin exists yet — safe to leave permanently set.')
			].join('\n'),
			'Bootstrap admin (required for header-auth)'
		);
	} else if (tenancy === 'multi') {
		p.note(
			[
				'On a public multi-tenant instance, the FIRST user to sign in becomes',
				pc.bold('Selva staff') + ' (every platform permission) unless you lock the bootstrap',
				'to a specific email. Strongly recommended to set this — leave blank only',
				'if you know what you are doing.',
				'',
				pc.dim('Also doubles as the recovery email if admin is ever lost.')
			].join('\n'),
			'Bootstrap admin'
		);
	} else {
		p.note(
			[
				'OPTIONAL — leave blank to let the first user who completes /setup become',
				'admin. Set it if you want only a specific email to be eligible (useful when',
				'the URL is shared before setup, or as a recovery handle if admin is ever lost).',
				'',
				pc.dim('Only consulted while no admin exists yet — safe to leave permanently set.')
			].join('\n'),
			'Bootstrap admin (optional)'
		);
	}

	const adminRequired = auth === 'header' || tenancy === 'multi';
	const adminEmail = await p.text({
		message: adminRequired
			? 'Email allowed to claim admin on first signup'
			: 'Email allowed to claim admin (leave blank to skip)',
		placeholder: adminRequired ? 'you@your-org.com' : '(press Enter to skip)',
		initialValue: defaults.BOOTSTRAP_INSTANCE_ADMIN_EMAIL ?? '',
		validate: (v) => {
			if (!v) {
				return adminRequired ? 'Required for this configuration.' : undefined;
			}
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Not a valid email.';
			return undefined;
		}
	});
	cancelOn(adminEmail);

	const behindProxy = await p.confirm({
		message: 'Behind a reverse proxy (Caddy, nginx, etc.)?',
		initialValue: Boolean(defaults.ORIGIN)
	});
	cancelOn(behindProxy);

	let origin = '';
	if (behindProxy) {
		const value = await p.text({
			message: 'Public-facing origin (no trailing slash) — sets ORIGIN',
			placeholder: 'https://your-domain.com',
			initialValue: defaults.ORIGIN ?? '',
			validate: (v) => {
				if (!v) return 'Required when behind a proxy.';
				try {
					new URL(v);
				} catch {
					return 'Must be a valid URL.';
				}
				if (v.endsWith('/')) return 'Drop the trailing slash.';
				return undefined;
			}
		});
		cancelOn(value);
		origin = String(value);

		if (origin.startsWith('http://')) {
			p.note(
				'Sessions use Secure cookies in production; browsers will silently\n' +
					'drop them over http://, so login will appear to succeed but the\n' +
					'next request will be anonymous.\n\n' +
					'Fix one of:\n' +
					'  • put TLS in front (recommended) — e.g. a domain + Caddy auto-cert\n' +
					'  • set ALLOW_INSECURE_COOKIES=true in .env (testing only — password\n' +
					'    auth over plain HTTP sends credentials in cleartext)',
				pc.yellow('⚠ Plain HTTP origin')
			);
		}
	}

	const flagOptions = promptableFlags(tenancy);

	const flagDefaults = flagOptions
		.map((o) => o.value)
		.filter((v) => envBool(defaults[`SELVA_FLAG_${v}`]));

	const flags = await p.multiselect({
		message: 'Platform feature flags (space to toggle, enter to confirm)',
		options: flagOptions,
		initialValues: flagDefaults,
		required: false
	});
	cancelOn(flags);

	const values = {
		SELVA_TENANCY: tenancy,
		SELVA_AUTH_PROVIDER: auth,
		SELVA_DATA_PROVIDER: data,
		SELVA_STORAGE_PROVIDER: storage,
		BOOTSTRAP_INSTANCE_ADMIN_EMAIL: stringValue(adminEmail),
		ORIGIN: origin,
		...providerValues
	};

	// Every key is written, including the ones the prompt hid — a missing key
	// reads as "unset" downstream, which is indistinguishable from "removed".
	// A hidden flag keeps whatever the existing .env had; only offered flags
	// are decided by the multiselect, so `init` can't silently clear one.
	const offered = new Set(flagOptions.map((o) => o.value));
	for (const name of FLAG_NAMES) {
		const key = `SELVA_FLAG_${name}`;
		if (!offered.has(name)) {
			values[key] = envBool(defaults[key]) ? 'true' : '';
			continue;
		}
		values[key] = Array.isArray(flags) && flags.includes(name) ? 'true' : '';
	}

	return values;
}

function pickSameProviderDefault(defaults, auth) {
	const data = defaults.SELVA_DATA_PROVIDER ?? auth;
	const storage = defaults.SELVA_STORAGE_PROVIDER ?? auth;
	// No existing defaults means a fresh `create`, not a re-prompted `init` — default to
	// "same provider for all three" since there's nothing yet to disagree with auth.
	if (!defaults.SELVA_DATA_PROVIDER && !defaults.SELVA_STORAGE_PROVIDER) return true;
	return data === auth && storage === auth;
}

function cancelOn(v) {
	if (p.isCancel(v)) {
		p.cancel('Cancelled.');
		process.exit(0);
	}
}

function stringValue(v) {
	if (v === undefined || v === null) return '';
	return String(v);
}

function headerAuthSecurityWarning() {
	return [
		'Header-auth trusts identity headers from the upstream proxy. Anyone who',
		'reaches the app process directly can spoof them. You MUST ensure:',
		'',
		`  ${pc.bold('1.')} Network isolation — bind to 127.0.0.1 (or use a Unix socket / firewall).`,
		`  ${pc.bold('2.')} Proxy-side auth — the proxy authenticates every request against the IdP.`,
		`  ${pc.bold('3.')} Header scrubbing — the proxy strips inbound SELVA-* headers before adding`,
		'     its own, otherwise a browser can spoof them alongside the real ones.',
		'',
		pc.dim('See packages/providers/header-auth/README.md for the full deployment checklist.')
	].join('\n');
}
