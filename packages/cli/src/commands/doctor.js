// Validate deployment without starting it: files, secrets, layout, providers,
// boot persistence. Read-only; yellow warnings don't fail, red failures exit 1.

import { existsSync, readFileSync, readdirSync, accessSync, constants, statSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readEnvFile, RENAMED_ENV_VARS, REPLACED_ENV_VARS } from '../env.js';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import { detectDrift } from './migrate.js';

const HEX_64 = /^[0-9a-f]{64}$/i;
const PLACEHOLDER = 'replace-this-with-a-random-32-byte-hex-key';

export async function runDoctor() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	p.intro(pc.bgCyan(pc.black(' selva doctor ')));

	const checks = [];
	const env = readEnvFile(join(dir, '.env'));

	checks.push(checkFile(join(dir, '.env'), '.env present'));
	checks.push(checkFile(join(dir, 'ecosystem.config.cjs'), 'ecosystem.config.cjs present'));
	checks.push(checkLayoutDrift(dir));
	checks.push(checkSecret(env.SELVA_HMAC_KEY, 'SELVA_HMAC_KEY is a 32-byte hex string'));
	checks.push(checkSecret(env.SELVA_AT_REST_KEY, 'SELVA_AT_REST_KEY is a 32-byte hex string'));

	// Header-auth: auth only; data/storage must be local or supabase.
	const providers = {
		auth: (env.SELVA_AUTH_PROVIDER ?? 'local').toLowerCase(),
		data: (env.SELVA_DATA_PROVIDER ?? 'local').toLowerCase(),
		storage: (env.SELVA_STORAGE_PROVIDER ?? 'local').toLowerCase()
	};

	const validForAuth = new Set(['local', 'supabase', 'header']);
	const validForData = new Set(['local', 'supabase']);

	if (!validForAuth.has(providers.auth)) {
		checks.push(red(`SELVA_AUTH_PROVIDER="${providers.auth}" — expected local|supabase|header`));
	}
	if (!validForData.has(providers.data)) {
		checks.push(red(`SELVA_DATA_PROVIDER="${providers.data}" — expected local|supabase`));
	}
	if (!validForData.has(providers.storage)) {
		checks.push(red(`SELVA_STORAGE_PROVIDER="${providers.storage}" — expected local|supabase`));
	}

	const used = new Set(Object.values(providers));

	if (used.has('local')) {
		checks.push(checkDataPath(dir, env.DATA_PATH ?? './.selva-data'));
	}

	if (used.has('supabase')) {
		checks.push(checkSupabase(env));
		checks.push(checkSupabaseMigrations(dir, env));
	}

	if (providers.auth === 'header') {
		checks.push(...checkHeaderAuth(dir, env, providers.data));
	}

	const tenancy = (env.SELVA_TENANCY ?? 'single').toLowerCase();
	if (tenancy !== 'single' && tenancy !== 'multi') {
		checks.push(red(`SELVA_TENANCY="${tenancy}" — expected single|multi`));
	} else {
		checks.push(green(`SELVA_TENANCY=${tenancy}`));
	}

	checks.push(checkPackage(dir, '@selvajs/selva'));
	checks.push(checkCliRuntimeAlignment(dir));
	checks.push(...checkBootPersistence(dir));
	if (env.ORIGIN) {
		try {
			new URL(env.ORIGIN);
			checks.push(green(`ORIGIN=${env.ORIGIN}`));
		} catch {
			checks.push(red(`ORIGIN="${env.ORIGIN}" is not a valid URL`));
		}
	} else {
		checks.push(yellow('ORIGIN unset — required behind a reverse proxy'));
	}

	for (const [oldName, newName] of Object.entries(RENAMED_ENV_VARS)) {
		if (env[oldName] === undefined) continue;
		checks.push(
			env[newName] === undefined
				? yellow(`${oldName} is deprecated — \`selva migrate\` renames it to ${newName}`)
				: yellow(`${oldName} is deprecated and ignored — ${newName} is set and wins`)
		);
	}

	// Not auto-fixable: the replacement encodes a value, so migrate won't guess.
	for (const [oldName, replacement] of Object.entries(REPLACED_ENV_VARS)) {
		if (env[oldName] === undefined) continue;
		checks.push(yellow(`${oldName} is deprecated — replace it with ${replacement}`));
	}

	// ── Render ─────────────────────────────────────────────────────────
	let failures = 0;
	for (const c of await Promise.all(checks)) {
		console.log('  ' + c.line);
		if (c.severity === 'red') failures += 1;
	}

	if (failures === 0) {
		p.outro(pc.green('All checks passed.'));
	} else {
		p.outro(pc.red(`${failures} check${failures === 1 ? '' : 's'} failed.`));
		process.exit(1);
	}
}

function green(text) {
	return { severity: 'green', line: `${pc.green('✓')} ${text}` };
}
function yellow(text) {
	return { severity: 'yellow', line: `${pc.yellow('!')} ${text}` };
}
function red(text) {
	return { severity: 'red', line: `${pc.red('✗')} ${text}` };
}

function checkFile(path, label) {
	return existsSync(path) ? green(label) : red(`${label} (missing: ${path})`);
}

function checkSecret(value, label) {
	if (!value) return red(`${label} — unset`);
	if (value === PLACEHOLDER) return red(`${label} — still the placeholder`);
	if (!HEX_64.test(value)) return red(`${label} — not 64 hex chars`);
	return green(label);
}

function checkDataPath(dir, dataPath) {
	const absolute = resolve(dir, dataPath);
	try {
		if (existsSync(absolute)) {
			const stat = statSync(absolute);
			if (!stat.isDirectory()) {
				return red(`DATA_PATH=${dataPath} exists but isn't a directory`);
			}
			accessSync(absolute, constants.W_OK);
			return green(`DATA_PATH=${dataPath} (writable)`);
		}
		// Parent must be writable so the runtime can create the directory.
		const parent = resolve(absolute, '..');
		if (!existsSync(parent)) {
			return yellow(`DATA_PATH=${dataPath} doesn't exist yet (parent missing: ${parent})`);
		}
		accessSync(parent, constants.W_OK);
		return yellow(`DATA_PATH=${dataPath} doesn't exist yet — will be created on first run`);
	} catch {
		return red(`DATA_PATH=${dataPath} not writable`);
	}
}

async function checkSupabase(env) {
	if (!env.SUPABASE_URL) return red('SUPABASE_URL unset');
	if (!env.SUPABASE_ANON_KEY) return red('SUPABASE_ANON_KEY unset');
	if (!env.SUPABASE_SERVICE_ROLE_KEY) return red('SUPABASE_SERVICE_ROLE_KEY unset');

	try {
		new URL(env.SUPABASE_URL);
	} catch {
		return red(`SUPABASE_URL="${env.SUPABASE_URL}" is not a valid URL`);
	}

	// Ping the Supabase health endpoint. Soft-fail to yellow on network
	// errors — operators may be offline at install time.
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);
		const res = await fetch(env.SUPABASE_URL + '/auth/v1/health', {
			signal: controller.signal
		});
		clearTimeout(timer);
		if (res.ok) return green(`SUPABASE_URL reachable (${res.status})`);
		return yellow(`SUPABASE_URL responded ${res.status} — check project status`);
	} catch (err) {
		return yellow(`SUPABASE_URL unreachable (${err.message ?? err}) — skipping`);
	}
}

// App↔DB schema handshake (audit O3). Expected head = newest migration shipped
// by the installed @selvajs/supabase-provider; actual = what the database
// reports via the selva.migration_head() RPC. Red on skew — the app degrades
// /api/health to 503 at boot in the same state, so catching it here saves a
// confusing deploy.
async function checkSupabaseMigrations(dir, env) {
	if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		return yellow('Migration-head check skipped — Supabase env incomplete');
	}

	const migrationsDir = join(
		dir,
		'node_modules',
		'@selvajs',
		'supabase-provider',
		'supabase',
		'migrations'
	);
	let expected = null;
	try {
		expected =
			readdirSync(migrationsDir)
				.filter((f) => /^\d{14}_.+\.sql$/.test(f))
				.map((f) => f.slice(0, 14))
				.sort()
				.pop() ?? null;
	} catch {
		// Provider package not installed in this deployment.
	}
	if (!expected) {
		return yellow(
			'@selvajs/supabase-provider migrations not found — skipping migration-head check'
		);
	}

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);
		const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/migration_head', {
			method: 'POST',
			headers: {
				apikey: env.SUPABASE_SERVICE_ROLE_KEY,
				Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
				'Content-Type': 'application/json',
				// The function lives in the selva schema the app is pinned to.
				'Content-Profile': 'selva'
			},
			body: '{}',
			signal: controller.signal
		});
		clearTimeout(timer);
		if (res.status === 404) {
			return red(
				`Database is missing selva.migration_head() — migrations are pending (expected head ${expected}). Sync + run: npx supabase db push`
			);
		}
		if (!res.ok) {
			return yellow(`migration_head RPC responded ${res.status} — cannot verify schema head`);
		}
		const actual = String((await res.json()) ?? '');
		if (!actual) {
			return red(
				`Database reports no applied migrations (expected head ${expected}). Sync + run: npx supabase db push`
			);
		}
		if (actual < expected) {
			return red(
				`Database migration head ${actual} is behind the installed provider (${expected}). Sync + run: npx supabase db push`
			);
		}
		return green(`Database migration head ${actual} matches the installed provider`);
	} catch (err) {
		// Soft-fail on network errors, same as checkSupabase.
		return yellow(`Migration-head check skipped (${err.message ?? err})`);
	}
}

function checkPackage(dir, name) {
	const path = join(dir, 'node_modules', ...name.split('/'), 'package.json');
	if (!existsSync(path)) return red(`${name} not installed (run npm install)`);
	return green(`${name} installed`);
}

function readPackageVersion(pkgJsonPath) {
	try {
		return JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version ?? null;
	} catch {
		return null;
	}
}

function majorOf(version) {
	const m = /^(\d+)\./.exec(version ?? '');
	return m ? Number(m[1]) : null;
}

// CLI and runtime release together (fixed group); major skew = stale CLI pin.
function checkCliRuntimeAlignment(dir) {
	const here = dirname(fileURLToPath(import.meta.url));
	const cliVersion = readPackageVersion(join(here, '..', '..', 'package.json'));
	const runtimeVersion = readPackageVersion(
		join(dir, 'node_modules', '@selvajs', 'selva', 'package.json')
	);

	// Runtime missing is already reported red by checkPackage; stay quiet here.
	if (!runtimeVersion) return yellow('CLI/runtime version check skipped (runtime not installed)');
	if (!cliVersion) return yellow('CLI/runtime version check skipped (could not read CLI version)');

	const cliMajor = majorOf(cliVersion);
	const runtimeMajor = majorOf(runtimeVersion);
	if (cliMajor === null || runtimeMajor === null) {
		return yellow(`CLI ${cliVersion} / runtime ${runtimeVersion} — unparseable version, skipping`);
	}

	if (cliMajor === runtimeMajor) {
		return green(`CLI ${cliVersion} aligned with runtime ${runtimeVersion} (major ${cliMajor})`);
	}

	return red(
		`CLI major (${cliVersion}) != runtime major (${runtimeVersion}) — the @selvajs/cli pin ` +
			`is stale. A caret range won't cross a major, so update it explicitly:\n     ` +
			`npm install @selvajs/cli@^${runtimeMajor} && selva restart`
	);
}

// Verify VM reboot will resurrect app: dump.pm2 saved, systemd unit installed, no stray global pm2.
function checkBootPersistence(dir) {
	// pm2's boot integration is Linux/systemd-specific. On macOS it's launchd
	// (different unit path) and on Windows pm2 boot persistence isn't a thing —
	// stay silent rather than emit misleading checks.
	if (process.platform !== 'linux') return [];

	const out = [];

	// dump.pm2 (what pm2 startup resurrects).
	const pm2Home = process.env.PM2_HOME ?? join(homedir(), '.pm2');
	const dumpPath = join(pm2Home, 'dump.pm2');
	if (existsSync(dumpPath)) {
		out.push(green('pm2 process list saved (dump.pm2 present)'));
	} else {
		out.push(
			yellow(
				'pm2 process list not saved — run `npx pm2 save` so a reboot can ' +
					'resurrect the app (nothing to restore without it)'
			)
		);
	}

	// systemd unit: present and pointing at deployment-local pm2.
	const user = process.env.USER ?? process.env.LOGNAME;
	const unitPath = user ? `/etc/systemd/system/pm2-${user}.service` : null;

	if (unitPath && existsSync(unitPath)) {
		const localPm2 = join(dir, 'node_modules', 'pm2', 'bin', 'pm2');
		let unit = '';
		try {
			unit = readFileSync(unitPath, 'utf8');
		} catch {
			out.push(yellow(`pm2 systemd unit present but unreadable (${unitPath})`));
			return out;
		}
		const execStart = /^ExecStart=(.+)$/m.exec(unit)?.[1] ?? '';
		if (execStart.includes(localPm2)) {
			out.push(green('pm2 systemd boot unit installed (uses deployment-local pm2)'));
		} else {
			out.push(
				red(
					`pm2 systemd boot unit points at a different pm2 than this deployment's.\n     ` +
						`ExecStart: ${execStart || '(not found)'}\n     ` +
						`expected:  ${localPm2} resurrect\n     ` +
						`Reboots will resurrect via the wrong pm2 (version skew). Re-run startup ` +
						`with the local binary:\n     ` +
						`sudo env PATH=$PATH:${join(dir, 'node_modules', '.bin')} ${localPm2} ` +
						`startup systemd -u $USER --hp $HOME`
				)
			);
		}
	} else {
		out.push(
			yellow(
				'pm2 systemd boot unit not installed — the app will NOT restart after a ' +
					'reboot. Run `npx pm2 startup systemd -u $USER --hp $HOME` and paste the ' +
					'printed command (point it at this deployment’s pm2).'
			)
		);
	}

	// Warn if global pm2 is on PATH (root cause of version skew).
	const globalPm2 = findGlobalPm2(dir);
	if (globalPm2) {
		out.push(
			yellow(
				`a pm2 outside this deployment is on PATH (${globalPm2}) — it can fork a ` +
					`mismatched daemon and trigger skew. Prefer \`npm run\` wrappers / \`npx pm2\` ` +
					`from this directory; consider \`npm uninstall -g pm2\`.`
			)
		);
	}

	return out;
}

// Scan PATH for stray pm2 binary (read-only).
function findGlobalPm2(dir) {
	const localBin = resolve(dir, 'node_modules', '.bin');
	const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
	for (const d of dirs) {
		if (resolve(d) === localBin) continue;
		const candidate = join(d, 'pm2');
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function checkLayoutDrift(dir) {
	const pkgPath = join(dir, 'package.json');
	if (!existsSync(pkgPath)) return yellow('package.json missing — cannot check layout');
	let pkg;
	try {
		pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	} catch {
		return red('package.json is not valid JSON');
	}
	const reasons = detectDrift(pkg, dir);
	if (reasons.length === 0) return green('deployment layout is current');
	return red(
		`deployment layout is outdated — run \`selva migrate\`:\n     ` +
			reasons.map((r) => '· ' + r).join('\n     ')
	);
}

// Must match HeaderAuthProvider.DEFAULT_HEADERS (duplicated to avoid loading runtime).
// Smoke test in providers/header-auth pins them; divergence surfaces in CI.
const DEFAULT_HEADER_NAMES = {
	upn: 'SELVA-UserPrincipalName',
	email: 'SELVA-Email',
	displayName: 'SELVA-DisplayName'
};

// Header-auth checks (read-only; runtime invariants like spoofing can't be verified).
function checkHeaderAuth(dir, env, dataProvider) {
	const out = [];

	// Allowlist file location.
	const allowlistDir = env.HEADER_AUTH_DATA_DIR ?? env.DATA_PATH;
	if (!allowlistDir) {
		out.push(red('HEADER_AUTH_DATA_DIR (or DATA_PATH) unset — provider will fail to start'));
	} else {
		const allowlistAbsDir = resolve(dir, allowlistDir);
		const allowlistPath = join(allowlistAbsDir, 'header-allowlist.json');
		if (existsSync(allowlistPath)) {
			out.push(green(`header-allowlist.json present (${allowlistDir}/header-allowlist.json)`));
		} else {
			// Provider creates lazily, but missing file locks everyone out.
			out.push(
				yellow(
					`header-allowlist.json not found at ${allowlistDir}/ — no users will be allowed in until one is added`
				)
			);

			// Check writability only if explicitly set (DATA_PATH checked separately).
			if (env.HEADER_AUTH_DATA_DIR) {
				out.push(checkDirWritable(allowlistAbsDir, `HEADER_AUTH_DATA_DIR=${allowlistDir}`));
			}
		}
	}

	// HOST binding (loopback recommended for header-auth).
	const host = env.HOST ?? '0.0.0.0';
	if (host === '127.0.0.1' || host === 'localhost') {
		out.push(green(`HOST=${host} (loopback-only)`));
	} else {
		out.push(
			yellow(
				`HOST=${host} — header-auth deployments should bind to 127.0.0.1 unless ` +
					`network isolation is enforced elsewhere (firewall, Docker network).`
			)
		);
	}

	// 3. ORIGIN — header-auth implies a reverse proxy, so ORIGIN is required.
	if (!env.ORIGIN) {
		out.push(red('ORIGIN unset — required for header-auth (always behind a proxy)'));
	}

	// Non-local data provider: HEADER_AUTH_DATA_DIR must be explicit (no DATA_PATH fallback).
	if (dataProvider !== 'local' && !env.HEADER_AUTH_DATA_DIR) {
		out.push(
			red(
				'HEADER_AUTH_DATA_DIR must be set when data provider is not local ' +
					'(no DATA_PATH to fall back to)'
			)
		);
	}

	// 5. Bootstrap admin email. Without it, the first proxy-authenticated
	// visitor's UPN is rejected (not in allowlist) and the operator has to
	// hand-write JSON to claim admin. With it, the first matching visit is
	// auto-allowlisted and granted instance_admin in one step.
	if (!env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL) {
		out.push(
			red(
				'BOOTSTRAP_INSTANCE_ADMIN_EMAIL unset — header-auth has no /setup form, ' +
					'so without this you cannot claim admin on first visit.'
			)
		);
	} else {
		out.push(green(`BOOTSTRAP_INSTANCE_ADMIN_EMAIL=${env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL}`));
	}

	// Resolved header names (print for diffing against proxy config; partial override = typo risk).
	const resolved = {
		upn: env.HEADER_AUTH_UPN_HEADER || DEFAULT_HEADER_NAMES.upn,
		email: env.HEADER_AUTH_EMAIL_HEADER || DEFAULT_HEADER_NAMES.email,
		displayName: env.HEADER_AUTH_DISPLAY_NAME_HEADER || DEFAULT_HEADER_NAMES.displayName
	};
	const overrides = [
		Boolean(env.HEADER_AUTH_UPN_HEADER),
		Boolean(env.HEADER_AUTH_EMAIL_HEADER),
		Boolean(env.HEADER_AUTH_DISPLAY_NAME_HEADER)
	].filter(Boolean).length;
	const headerList = `UPN=${resolved.upn}, Email=${resolved.email}, DisplayName=${resolved.displayName}`;
	if (overrides === 0) {
		out.push(green(`header names (bundled defaults): ${headerList}`));
	} else if (overrides === 3) {
		out.push(green(`header names (all overridden): ${headerList}`));
	} else {
		out.push(
			yellow(
				`header names partially overridden (${overrides}/3 set): ${headerList} — ` +
					`a partial override is usually a typo. Set all three or none.`
			)
		);
	}

	return out;
}

function checkDirWritable(absDir, label) {
	try {
		if (existsSync(absDir)) {
			const stat = statSync(absDir);
			if (!stat.isDirectory()) return red(`${label} exists but isn't a directory`);
			accessSync(absDir, constants.W_OK);
			return green(`${label} writable`);
		}
		const parent = resolve(absDir, '..');
		if (!existsSync(parent)) {
			return yellow(`${label} doesn't exist yet (parent missing: ${parent})`);
		}
		accessSync(parent, constants.W_OK);
		return yellow(`${label} doesn't exist yet — will be created on first run`);
	} catch {
		return red(`${label} not writable`);
	}
}
