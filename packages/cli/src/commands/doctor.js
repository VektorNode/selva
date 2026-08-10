// Validate deployment without starting it: files, secrets, layout, providers,
// Node engine, boot persistence. Yellow warnings don't fail, red failures exit 1.
//
// Read-only by default. `--fix` applies the repairs attached to individual
// checks, each behind its own confirmation — only fixes needing no root and
// no runtime restart exist. See applyFixes.

import {
	existsSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	readdirSync,
	accessSync,
	constants,
	statSync,
	rmSync
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readEnvFile, parseEnv, countEnvCommentLines, stripEnvComments } from '../env.js';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import { satisfiesNodeRange } from '../node-range.js';
import { green, yellow, red, fixable } from '../checks/result.js';
import { checkBootPersistence } from '../checks/boot.js';
import { checkRuntimeEnvironment } from '../checks/runtime.js';
import {
	checkDeprecatedEnv,
	checkEnvDocumentation,
	checkHeaderNames,
	checkOrigin,
	checkProviders,
	checkSecret,
	checkTenancy,
	resolveProviders
} from '../checks/config.js';
import { BACKUP_AGE_DAYS, classifyBackups, detectDrift, NODE_MODULES_STASH } from './migrate.js';

export async function runDoctor(argv = []) {
	const fix = argv.includes('--fix');
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	p.intro(pc.bgCyan(pc.black(fix ? ' selva doctor --fix ' : ' selva doctor ')));

	const checks = [];
	const env = readEnvFile(join(dir, '.env'));

	checks.push(checkFile(join(dir, '.env'), '.env present'));
	checks.push(checkFile(join(dir, 'ecosystem.config.cjs'), 'ecosystem.config.cjs present'));
	checks.push(checkLayoutDrift(dir));
	checks.push(checkMigrationLeftovers(dir));
	checks.push(checkAgedBackups(dir));
	checks.push(checkSecret(env.SELVA_HMAC_KEY, 'SELVA_HMAC_KEY is a 32-byte hex string'));
	checks.push(checkSecret(env.SELVA_AT_REST_KEY, 'SELVA_AT_REST_KEY is a 32-byte hex string'));

	const providers = resolveProviders(env);
	checks.push(...checkProviders(providers));

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

	checks.push(checkTenancy(env));

	checks.push(checkPackage(dir, '@selvajs/selva'));
	checks.push(checkNodeEngine(dir));
	checks.push(checkCliRuntimeAlignment(dir));
	checks.push(...checkRuntimeEnvironment(dir));
	checks.push(...checkBootPersistence(dir));
	checks.push(checkOrigin(env));
	checks.push(...checkDeprecatedEnv(env));
	checks.push(checkEnvDocs(dir));

	// ── Render ─────────────────────────────────────────────────────────
	const resolved = await Promise.all(checks);
	let failures = 0;
	for (const c of resolved) {
		console.log('  ' + c.line);
		if (c.severity === 'red') failures += 1;
	}

	if (fix) {
		failures = await applyFixes(resolved, failures);
	} else {
		const repairable = resolved.filter((c) => c.fix).length;
		if (repairable > 0) {
			p.log.info(
				`${repairable} issue${repairable === 1 ? '' : 's'} can be repaired automatically — ` +
					`re-run with \`npx selva doctor --fix\`.`
			);
		}
	}

	if (failures === 0) {
		p.outro(pc.green('All checks passed.'));
	} else {
		p.outro(pc.red(`${failures} check${failures === 1 ? '' : 's'} failed.`));
		process.exit(1);
	}
}

// Anything privileged (the systemd unit) or that would restart this process
// (a Node upgrade) stays a printed instruction instead of a fixer — one that
// dies halfway through its own runtime leaves the operator with no way back.
async function applyFixes(resolved, failures) {
	const repairs = resolved.filter((c) => c.fix && c.severity !== 'green');
	if (repairs.length === 0) {
		p.log.info('Nothing to repair automatically.');
		return failures;
	}

	console.log('');
	p.log.step(`${repairs.length} repair${repairs.length === 1 ? '' : 's'} available`);

	for (const check of repairs) {
		const approved = await p.confirm({
			message: check.fix.label,
			initialValue: false
		});
		if (p.isCancel(approved) || !approved) {
			p.log.info('Skipped.');
			continue;
		}
		let result;
		try {
			result = await check.fix.run();
		} catch (err) {
			result = red(`repair threw: ${err instanceof Error ? err.message : String(err)}`);
		}
		console.log('  ' + result.line);
		if (result.severity === 'green' && check.severity === 'red') failures -= 1;
	}
	return failures;
}

function checkFile(path, label) {
	return existsSync(path) ? green(label) : red(`${label} (missing: ${path})`);
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

	// Network errors go yellow, not red — operators may be offline at install time.
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

// Compares the newest migration shipped by @selvajs/supabase-provider against
// what the database reports via selva.migration_head(). Red on skew — the app
// degrades /api/health to 503 at boot in the same state, so catching it here
// saves a confusing deploy.
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
		// String comparison — relies on both heads being fixed-width, zero-padded timestamps.
		if (actual < expected) {
			return red(
				`Database migration head ${actual} is behind the installed provider (${expected}). Sync + run: npx supabase db push`
			);
		}
		return green(`Database migration head ${actual} matches the installed provider`);
	} catch (err) {
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

// CLI and runtime release as a fixed group; major-version skew means a stale CLI pin.
function checkCliRuntimeAlignment(dir) {
	const here = dirname(fileURLToPath(import.meta.url));
	const cliVersion = readPackageVersion(join(here, '..', '..', 'package.json'));
	const runtimeVersion = readPackageVersion(
		join(dir, 'node_modules', '@selvajs', 'selva', 'package.json')
	);

	// checkPackage already reports missing runtime as red; stay quiet here.
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

// npm only enforces engines.node under engine-strict=true, which no deployment
// sets, so a mismatched install succeeds silently and /api/health still returns
// 200 — routes using newer APIs throw only under real traffic. Not auto-fixable:
// upgrading Node is distro-specific and would restart the process running this check.
function checkNodeEngine(dir) {
	let required;
	try {
		const pkg = JSON.parse(
			readFileSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'), 'utf8')
		);
		required = pkg.engines?.node;
	} catch {
		return yellow('@selvajs/selva engines.node — package.json unreadable, skipped');
	}
	if (typeof required !== 'string') {
		return yellow('@selvajs/selva declares no engines.node — cannot verify this host');
	}

	const running = process.versions.node;
	const ok = satisfiesNodeRange(running, required);
	if (ok === null) {
		return yellow(`engines.node "${required}" not understood — verify Node v${running} manually`);
	}
	if (ok) return green(`Node v${running} satisfies engines.node ${required}`);

	return red(
		`Node v${running} does NOT satisfy @selvajs/selva's engines.node ${required}.\n     ` +
			`npm installs it anyway and the health check still passes, so this fails only\n     ` +
			`under real traffic. Upgrade Node on this host (nvm/fnm or your package manager),\n     ` +
			`then: npm rebuild && npm run restart`
	);
}

// `selva migrate` parks the old node_modules aside so a failed install can be
// rolled back, and removes it on either outcome. One surviving here means the
// migration was killed mid-flight — worth flagging since it's a full copy of
// the dependency tree and the deployment may be running on the wrong one.
function checkMigrationLeftovers(dir) {
	const stash = join(dir, NODE_MODULES_STASH);
	if (!existsSync(stash)) return green('no interrupted migration left behind');
	return yellow(
		`${NODE_MODULES_STASH} exists — a \`selva migrate\` was interrupted. If the app ` +
			`is healthy, delete it: rm -rf ${stash}`,
		fixable(`delete the leftover ${NODE_MODULES_STASH}`, () => {
			try {
				rmSync(stash, { recursive: true, force: true });
				return green(`removed ${NODE_MODULES_STASH}`);
			} catch (err) {
				return red(`could not remove ${stash}: ${err instanceof Error ? err.message : err}`);
			}
		})
	);
}

// Migration backups are timestamped so a later migration can't overwrite an
// earlier one's (#184), which means they accumulate. Deleting them silently
// would throw away the operator's only copy of a pre-migration config, so this
// reports and lets `--fix` opt in. `classifyBackups` always keeps the newest
// run, so the escape hatch is never emptied — only superseded generations go.
function checkAgedBackups(dir) {
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return green('no aged migration backups');
	}

	const { aged } = classifyBackups(names);
	if (aged.length === 0) return green('no aged migration backups');

	const shown = aged.slice(0, 3).join(', ');
	const more = aged.length > 3 ? `, +${aged.length - 3} more` : '';
	return yellow(
		`${aged.length} migration backup${aged.length === 1 ? '' : 's'} older than ` +
			`${BACKUP_AGE_DAYS} days (${shown}${more}). The newest set is kept either way.`,
		fixable(`delete ${aged.length} aged migration backup${aged.length === 1 ? '' : 's'}`, () => {
			const failed = [];
			for (const name of aged) {
				try {
					rmSync(join(dir, name), { force: true });
				} catch (err) {
					failed.push(`${name} (${err instanceof Error ? err.message : err})`);
				}
			}
			if (failed.length > 0) return red(`could not remove: ${failed.join(', ')}`);
			return green(`removed ${aged.length} aged backup${aged.length === 1 ? '' : 's'}`);
		})
	);
}

// Reads the raw file rather than the parsed env: the finding IS the comments,
// which parseEnv discards. The repair is attached here (not in checks/config.js)
// to keep that module filesystem-free.
function checkEnvDocs(dir) {
	const envPath = join(dir, '.env');
	if (!existsSync(envPath)) return green('.env documentation check skipped (no .env)');

	let text;
	try {
		text = readFileSync(envPath, 'utf8');
	} catch (err) {
		return yellow(`.env unreadable (${err instanceof Error ? err.message : err})`);
	}

	return checkEnvDocumentation(
		countEnvCommentLines(text),
		fixable('strip the shipped documentation from .env (backup: .env.bak)', () => {
			try {
				// Re-read at repair time: doctor may have run minutes ago in --fix's
				// confirmation loop, and rewriting from a stale snapshot would silently
				// revert an edit made in between.
				const current = readFileSync(envPath, 'utf8');
				const { text: strippedText, removed } = stripEnvComments(current);
				// A rewrite that changes which settings are live is a bug, not a
				// cleanup — refuse rather than hand back a subtly different deployment.
				const before = parseEnv(current);
				const after = parseEnv(strippedText);
				const drift = diffEnvKeys(before, after);
				if (drift) return red(`refused to strip .env — ${drift}`);

				copyFileSync(envPath, envPath + '.bak');
				writeFileSync(envPath, strippedText, 'utf8');
				return green(`stripped ${removed} comment lines from .env (backup: .env.bak)`);
			} catch (err) {
				return red(`could not rewrite .env: ${err instanceof Error ? err.message : err}`);
			}
		})
	);
}

// Names the first discrepancy between two parsed envs, or null when identical.
function diffEnvKeys(before, after) {
	for (const key of Object.keys(before)) {
		if (!(key in after)) return `${key} would be lost`;
		if (before[key] !== after[key]) return `${key} would change value`;
	}
	for (const key of Object.keys(after)) {
		if (!(key in before)) return `${key} would be added`;
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

// Static config only — runtime invariants like spoofing protection can't be checked from here.
function checkHeaderAuth(dir, env, dataProvider) {
	const out = [];

	const allowlistDir = env.HEADER_AUTH_DATA_DIR ?? env.DATA_PATH;
	if (!allowlistDir) {
		out.push(red('HEADER_AUTH_DATA_DIR (or DATA_PATH) unset — provider will fail to start'));
	} else {
		const allowlistAbsDir = resolve(dir, allowlistDir);
		const allowlistPath = join(allowlistAbsDir, 'header-allowlist.json');
		if (existsSync(allowlistPath)) {
			out.push(green(`header-allowlist.json present (${allowlistDir}/header-allowlist.json)`));
		} else {
			// The provider creates this file lazily, but a missing file locks everyone out
			// until one exists — worth a warning even though nothing is technically broken.
			out.push(
				yellow(
					`header-allowlist.json not found at ${allowlistDir}/ — no users will be allowed in until one is added`
				)
			);

			// DATA_PATH's own writability is checked separately (checkDataPath).
			if (env.HEADER_AUTH_DATA_DIR) {
				out.push(checkDirWritable(allowlistAbsDir, `HEADER_AUTH_DATA_DIR=${allowlistDir}`));
			}
		}
	}

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

	// header-auth always sits behind a reverse proxy, so ORIGIN is required.
	if (!env.ORIGIN) {
		out.push(red('ORIGIN unset — required for header-auth (always behind a proxy)'));
	}

	if (dataProvider !== 'local' && !env.HEADER_AUTH_DATA_DIR) {
		out.push(
			red(
				'HEADER_AUTH_DATA_DIR must be set when data provider is not local ' +
					'(no DATA_PATH to fall back to)'
			)
		);
	}

	// Without this, the first proxy-authenticated visitor's UPN is rejected
	// (not in the allowlist) and the operator has to hand-write JSON to claim
	// admin. With it, the first matching visit auto-allowlists and grants
	// instance_admin in one step.
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

	out.push(checkHeaderNames(env));

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
