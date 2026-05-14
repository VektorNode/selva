// `selva doctor` — validate a deployment without starting it.
//
// Checks:
//   • .env and ecosystem.config.cjs exist
//   • Layout drift (legacy provider packages, stale selva.config.js, etc.)
//   • Secrets are present and look like 32-byte hex
//   • DATA_PATH writable (when local provider is in use)
//   • Supabase URL reachable (when supabase provider is in use)
//   • @selvajs/selva installed
//   • Origin set when behind a reverse proxy looks set
//
// Exits 0 (green) or 1 (any red); yellow checks don't fail the run.

import { existsSync, readFileSync, accessSync, constants, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readEnvFile } from '../env.js';
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

	// ── Files ──────────────────────────────────────────────────────────
	checks.push(checkFile(join(dir, '.env'), '.env present'));
	checks.push(checkFile(join(dir, 'ecosystem.config.cjs'), 'ecosystem.config.cjs present'));

	// ── Layout drift ───────────────────────────────────────────────────
	// Catches deployments still on the @selvajs/runtime layout (or other
	// historical states) and points the operator at `selva migrate` instead
	// of just letting the missing-package checks below scream.
	checks.push(checkLayoutDrift(dir));

	// ── Secrets ────────────────────────────────────────────────────────
	checks.push(checkSecret(env.SELVA_HMAC_KEY, 'SELVA_HMAC_KEY is a 32-byte hex string'));
	checks.push(checkSecret(env.SELVA_AT_REST_KEY, 'SELVA_AT_REST_KEY is a 32-byte hex string'));

	// ── Provider wiring ────────────────────────────────────────────────
	// `header` is only valid for the auth slot — data/storage stay
	// local|supabase. Mirror what providers.server.ts enforces.
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
	}

	if (providers.auth === 'header') {
		checks.push(...checkHeaderAuth(dir, env, providers.data));
	}

	// ── Tenancy ────────────────────────────────────────────────────────
	const tenancy = (env.SELVA_TENANCY ?? 'single').toLowerCase();
	if (tenancy !== 'single' && tenancy !== 'multi') {
		checks.push(red(`SELVA_TENANCY="${tenancy}" — expected single|multi`));
	} else {
		checks.push(green(`SELVA_TENANCY=${tenancy}`));
	}

	// ── Installed packages ─────────────────────────────────────────────
	// Provider implementations are bundled into @selvajs/selva — only the
	// runtime package needs to be on disk.
	checks.push(checkPackage(dir, '@selvajs/selva'));

	// ── Origin (best-effort) ───────────────────────────────────────────
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

function checkPackage(dir, name) {
	const path = join(dir, 'node_modules', ...name.split('/'), 'package.json');
	if (!existsSync(path)) return red(`${name} not installed (run npm install)`);
	return green(`${name} installed`);
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

// Header-auth-specific sanity checks. None of these catch the truly dangerous
// misconfigurations (header spoofing, missing proxy auth) — those are
// runtime invariants we can't verify from here. We DO check the things we can:
// allowlist file presence, HOST binding, ORIGIN, and logout URL.
function checkHeaderAuth(dir, env, dataProvider) {
	const out = [];

	// 1. Where does header-allowlist.json live?
	const allowlistDir = env.HEADER_AUTH_DATA_DIR ?? env.DATA_PATH;
	if (!allowlistDir) {
		out.push(red('HEADER_AUTH_DATA_DIR (or DATA_PATH) unset — provider will fail to start'));
	} else {
		const allowlistPath = resolve(dir, allowlistDir, 'header-allowlist.json');
		if (existsSync(allowlistPath)) {
			out.push(green(`header-allowlist.json present (${allowlistDir}/header-allowlist.json)`));
		} else {
			// The provider creates it lazily, but a fresh deployment with no
			// allowlisted UPNs locks everyone out — surface this so the
			// operator knows to bootstrap.
			out.push(
				yellow(
					`header-allowlist.json not found at ${allowlistDir}/ — no users will be allowed in until one is added`
				)
			);
		}
	}

	// 2. HOST binding. Loopback is strongly recommended for header-auth.
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

	// 4. If data provider isn't local, the allowlist file is the ONLY local
	// state — make sure the operator picked an explicit dir, not the
	// fall-through DATA_PATH which may not be set.
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

	return out;
}
