// Shared prompt flow used by both `create` (fresh scaffold) and
// `selva init` (reconfigure existing install). The two callers differ only in
// what defaults are passed in and what gets written afterwards.

import * as p from '@clack/prompts';
import pc from 'picocolors';

const TRUTHY = new Set(['true', '1', 'yes']);

function envBool(v) {
	if (v === undefined) return false;
	return TRUTHY.has(String(v).toLowerCase());
}

// Runs the full interactive prompt sequence and returns a flat object of
// env-var-name → value (string). The caller decides whether to merge with an
// existing .env or write fresh.
//
// `defaults` is an existing env map (from .env, or {}). Anything present there
// pre-populates the prompt so re-running is cheap.
export async function collectConfig({ defaults = {}, mode = 'create' } = {}) {
	const isInit = mode === 'init';

	p.intro(pc.bgCyan(pc.black(isInit ? ' selva init ' : ' Selva — new deployment ')));

	// Brand prompts (SELVA_BRAND_NAME / COPYRIGHT_NAME / TAGLINE / DESCRIPTION)
	// are skipped for now — the runtime falls back to "Selva" defaults when
	// these env vars are absent. To re-enable, add a brand prompt block here
	// and write the values into `values` below.

	// ── Tenancy ─────────────────────────────────────────────────────────
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

	// ── Auth provider ───────────────────────────────────────────────────
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

	// Header-auth is auth-only — it has no data/storage to share. The user
	// MUST pick a separate backend for those. Local is the sensible default
	// pairing (same filesystem as the allowlist).
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
		// In practice operators almost always want data + storage on the same
		// backend as auth. Ask once, default the others; let advanced users
		// override.
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

	// ── Provider-specific config ───────────────────────────────────────
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
		// HEADER_AUTH_DATA_DIR is where header-allowlist.json lives. When the
		// data provider is local, DATA_PATH is the natural home and we let
		// the provider fall back to it. Only ask explicitly if data isn't
		// local — otherwise there's no obvious default.
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
			// Preserve an explicit override if the operator set one previously.
			providerValues.HEADER_AUTH_DATA_DIR = defaults.HEADER_AUTH_DATA_DIR;
		}

		const logoutUrl = await p.text({
			message: 'HEADER_AUTH_LOGOUT_URL — where /logout redirects (IdP sign-out URL)',
			placeholder: 'https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/logout?...',
			initialValue: defaults.HEADER_AUTH_LOGOUT_URL ?? '',
			validate: (v) => {
				if (!v) return undefined; // optional — provider tolerates null
				try {
					new URL(v);
				} catch {
					return 'Must be a valid URL.';
				}
				return undefined;
			}
		});
		cancelOn(logoutUrl);
		providerValues.HEADER_AUTH_LOGOUT_URL = String(logoutUrl);

		if (!logoutUrl) {
			p.log.warn(
				'No HEADER_AUTH_LOGOUT_URL set — /logout will destroy the local session but ' +
					'the proxy will silently re-authenticate the user on the next request.'
			);
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

		// Header-auth deployments MUST bind to loopback. We don't force it
		// (the operator might run inside a Docker network where the proxy
		// reaches the container by service name), but we set HOST=127.0.0.1
		// as the default and let them override.
		const bindLoopback = await p.confirm({
			message: 'Bind the app to 127.0.0.1 only? (recommended for header-auth)',
			initialValue: !defaults.HOST || defaults.HOST === '127.0.0.1' || defaults.HOST === 'localhost'
		});
		cancelOn(bindLoopback);
		providerValues.HOST = bindLoopback ? '127.0.0.1' : stringValue(defaults.HOST);
	}

	// ── Bootstrap admin ────────────────────────────────────────────────
	// Two roles in one env var: (1) gate the "first-signup-becomes-admin"
	// path to a specific email — required for multi-tenant so a random
	// signup doesn't get Selva staff perms; (2) break-glass recovery if
	// admin is lost to a backup restore / manual DB edit. The check ONLY
	// runs while no admin exists yet, so leaving it set permanently is
	// safe. Phrase the prompt differently per tenancy because the
	// security implications differ.
	if (tenancy === 'multi') {
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

	const adminEmail = await p.text({
		message:
			tenancy === 'multi'
				? 'Email allowed to claim admin on first signup'
				: 'Email allowed to claim admin (leave blank to skip)',
		placeholder: tenancy === 'multi' ? 'you@your-org.com' : '(press Enter to skip)',
		initialValue: defaults.BOOTSTRAP_INSTANCE_ADMIN_EMAIL ?? '',
		validate: (v) => {
			if (!v) return undefined; // blank is allowed in single-tenant
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Not a valid email.';
			return undefined;
		}
	});
	cancelOn(adminEmail);

	// ── Reverse proxy ──────────────────────────────────────────────────
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
	}

	// ── Platform flags ─────────────────────────────────────────────────
	const flagOptions = [
		{
			value: 'ALLOW_ORG_CREATION',
			label: 'Allow non-admin users to create their own orgs',
			hint: 'multi-tenant self-service'
		},
		{
			value: 'ALLOW_CROSS_ORG_PUBLIC',
			label: 'Public projects visible across all orgs',
			hint: 'instance-wide discovery'
		},
		{
			value: 'ALLOW_ORG_COMPUTE_OVERRIDE',
			label: 'Orgs can configure their own Rhino.Compute server',
			hint: 'BYO compute'
		},
		{
			value: 'ENABLE_SHARING',
			label: 'Per-definition share links (anonymous external access)',
			hint: 'tokenized URLs'
		}
	];

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

	// ── Done ───────────────────────────────────────────────────────────
	const values = {
		SELVA_TENANCY: tenancy,
		SELVA_AUTH_PROVIDER: auth,
		SELVA_DATA_PROVIDER: data,
		SELVA_STORAGE_PROVIDER: storage,
		BOOTSTRAP_INSTANCE_ADMIN_EMAIL: stringValue(adminEmail),
		ORIGIN: origin,
		...providerValues
	};

	for (const opt of flagOptions) {
		const enabled = Array.isArray(flags) && flags.includes(opt.value);
		values[`SELVA_FLAG_${opt.value}`] = enabled ? 'true' : '';
	}

	return values;
}

// `selva init` should default to "yes, same provider for all three" only when
// the current .env already reflects that. If the operator deliberately split
// auth and data, don't re-merge them on reconfigure.
function pickSameProviderDefault(defaults, auth) {
	const data = defaults.SELVA_DATA_PROVIDER ?? auth;
	const storage = defaults.SELVA_STORAGE_PROVIDER ?? auth;
	if (!defaults.SELVA_DATA_PROVIDER && !defaults.SELVA_STORAGE_PROVIDER) return true;
	return data === auth && storage === auth;
}

function cancelOn(v) {
	// @clack/prompts returns Symbol(clack:cancel) when the user hits Ctrl+C.
	// p.isCancel() is the official API for detecting it.
	if (p.isCancel(v)) {
		p.cancel('Cancelled.');
		process.exit(0);
	}
}

function stringValue(v) {
	if (v === undefined || v === null) return '';
	return String(v);
}

// Shown once when the operator picks header-auth. The provider's README is
// emphatic that the deployment IS the security boundary — none of these
// invariants can be enforced at runtime, so we surface them up front.
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
		pc.dim('See packages/header-auth-provider/README.md for the full deployment checklist.')
	].join('\n');
}

export { p as prompts, pc as colors };
