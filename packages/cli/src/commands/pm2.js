// Thin wrappers around PM2 commands: resolve to the deployment-local pm2, resync
// the daemon before state changes, and pass --update-env on restart so edits to
// .env actually take effect.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import { readEnvFile } from '../env.js';
import { needsSupabaseProvider } from '../deployment-package.js';
import { checkSupabaseMigrations, providerTagFor } from '../checks/migrations.js';

export const APP_NAME = 'selva-compute';

export function pm2Bin(dir) {
	const local = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'pm2.cmd' : 'pm2');
	if (!existsSync(local)) {
		throw new Error(
			`pm2 not found at ${local}. The deployment owns its own pm2 — run ` +
				`\`npm install\` in ${dir} to install it. (We deliberately don't ` +
				`fall back to a global pm2; two pm2s managing the same daemon causes ` +
				`persistent skew warnings and hung restarts.)`
		);
	}
	return local;
}

// Parses the two versions pm2 prints alongside its out-of-date warning:
//   In memory PM2 version: 6.0.14
//   Local PM2 version: 5.4.3
// Returns nulls when the shape doesn't match, so callers fall back to resyncing.
export function parsePm2Skew(output) {
	// eslint-disable-next-line no-control-regex -- pm2 colourises via chalk on a TTY
	const clean = output.replace(/\[[0-9;]*m/g, '');
	const daemon = /In memory PM2 version:\s*v?(\d+\.\d+\.\d+)/i.exec(clean);
	const local = /Local PM2 version:\s*v?(\d+\.\d+\.\d+)/i.exec(clean);
	return { daemon: daemon?.[1] ?? null, local: local?.[1] ?? null };
}

// True when the running daemon is newer than the deployment-local pm2 — i.e. a
// foreign global pm2 owns it. `pm2 update` can't fix that direction: it would
// downgrade the daemon and hand it a dump from a newer version, dropping the
// process table so selva-compute never gets re-registered.
export function daemonOutranksCli(daemon, local) {
	if (!daemon || !local) return false;
	const [a, b] = [daemon.split('.').map(Number), local.split('.').map(Number)];
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return true;
		if (a[i] < b[i]) return false;
	}
	return false;
}

function ensurePm2InSync(dir) {
	const bin = pm2Bin(dir);
	const probe = spawnSync(bin, ['ping'], {
		cwd: dir,
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});
	const output = (probe.stdout ?? '') + (probe.stderr ?? '');
	if (!/out-of-date/i.test(output)) return;

	const { daemon, local } = parsePm2Skew(output);
	if (daemonOutranksCli(daemon, local)) {
		throw new Error(
			`The running PM2 daemon (v${daemon}) is NEWER than this deployment's pm2 (v${local}), ` +
				`so a global pm2 owns it. Running \`pm2 update\` would downgrade the daemon and drop ` +
				`its process table, leaving ${APP_NAME} unregistered. Resolve the conflict first: ` +
				`\`which -a pm2\`, \`pm2 -v\`, \`pm2 ping\`.`
		);
	}

	p.log.warn(
		'PM2 in-memory daemon is a different version than the deployment-local pm2 — ' +
			'running `pm2 update` to resync (this briefly restarts managed processes).'
	);
	const result = spawnSync(bin, ['update'], {
		cwd: dir,
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});
	if ((result.status ?? 1) !== 0) {
		throw new Error(
			'`pm2 update` failed — daemon and CLI remain out of sync. ' +
				'Investigate manually: `pm2 ping`, `pm2 -v`, `which -a pm2`.'
		);
	}
}

// `bin` lets a caller pass an already-resolved pm2 path instead of resolving
// fresh from `dir` — needed when node_modules won't exist at call time (e.g.
// `selva migrate` wipes it mid-flight and passes the binary it stashed first).
export function runPm2(dir, args, { inherit = true, bin = pm2Bin(dir) } = {}) {
	const result = spawnSync(bin, args, {
		cwd: dir,
		stdio: inherit ? 'inherit' : 'pipe',
		shell: process.platform === 'win32'
	});
	if (result.error) {
		throw new Error(
			`Failed to invoke pm2 (${bin}): ${result.error.message}. ` +
				`Install pm2 with \`npm install\` in this directory.`
		);
	}
	return result.status ?? 0;
}

export async function runStart() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	ensurePm2InSync(dir);
	const exit = runPm2(dir, ['start', 'ecosystem.config.cjs']);
	process.exit(exit);
}

export async function runStop() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	ensurePm2InSync(dir);
	const exit = runPm2(dir, ['stop', APP_NAME]);
	process.exit(exit);
}

export async function runRestart() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	ensurePm2InSync(dir);
	// --update-env is the whole point of this wrapper — without it, edits to
	// .env have no effect on the running process.
	const exit = runPm2(dir, ['restart', APP_NAME, '--update-env']);
	process.exit(exit);
}

export async function runLogs(argv) {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	const exit = runPm2(dir, ['logs', APP_NAME, ...argv]);
	process.exit(exit);
}

export async function runUpdate() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	p.intro(pc.bgCyan(pc.black(' selva update ')));

	const before = readRuntimeVersion(dir);
	p.log.info(`Current @selvajs/selva: ${before ?? 'unknown'}`);

	// The admin-center "Run update" button runs the same list: keep them in sync.
	const packages = ['@selvajs/cli', '@selvajs/selva'];
	const env = readEnvFile(join(dir, '.env'));
	const supabase = needsSupabaseProvider(env);

	const confirmed = await p.confirm({
		message: 'Refresh all @selvajs/* packages and restart the app?',
		initialValue: true
	});
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	ensurePm2InSync(dir);

	const stopStatus = runPm2(dir, ['stop', APP_NAME], { inherit: false });
	if (stopStatus !== 0) {
		p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
	}

	const s = p.spinner();
	s.start(`npm update ${packages.join(' ')}`);
	try {
		execSync(`npm update --save --prefer-online ${packages.join(' ')}`, {
			cwd: dir,
			stdio: 'pipe'
		});
		s.stop('npm update finished');
	} catch (err) {
		s.stop('npm update failed');
		runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
		throw err;
	}

	const after = readRuntimeVersion(dir);
	p.log.info(`New @selvajs/selva:     ${after ?? 'unknown'}`);

	realignPm2Pin(dir, s);

	if (supabase) {
		// Provider code is bundled into @selvajs/selva, but the migration SQL ships
		// here. Left behind, `selva-supabase` copies nothing new. Installed by tag,
		// not `npm update`d: its pin can sit on another channel than the runtime's.
		const spec = `@selvajs/supabase-provider@${providerTagFor(after)}`;
		s.start(`npm install ${spec}`);
		try {
			execSync(`npm install --save --prefer-online ${spec}`, { cwd: dir, stdio: 'pipe' });
			s.stop(`${spec} installed`);
		} catch (err) {
			s.stop(`npm install ${spec} failed`);
			p.log.warn(String(err.stderr ?? err.message ?? err).trim());
		}
	}

	if (before && after && before === after) {
		p.log.warn(
			[
				'No packages were updated — already on the latest version your npm cache knows about.',
				'If you expected a newer version (e.g. one was just published), your cache may be stale:',
				'',
				'  npm cache clean --force',
				'  rm -rf node_modules package-lock.json',
				'  npm install --prefer-online',
				'  npm run restart'
			].join('\n')
		);
	}

	// Migrations are not applied here: they aren't reversible, and the old build
	// is already gone. The app serves on an old schema (degraded), so start it and
	// say what is left to do.
	const schema = supabase ? await checkSupabaseMigrations(dir, env, after) : null;

	const status = runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
	if (status !== 0) {
		p.outro(pc.yellow(`Start failed — investigate with \`pm2 logs ${APP_NAME}\`.`));
		process.exitCode = 1;
		return;
	}

	const health = await waitForHealth(env);
	if (schema && schema.severity !== 'green') p.log.message(schema.line);
	if (health.ok) {
		p.outro(pc.green(`Started ${APP_NAME}`));
		return;
	}
	p.outro(
		pc.red(
			health.status
				? `Started ${APP_NAME}, but /api/health returned ${health.status}: ${health.reason}`
				: `Started ${APP_NAME}, but /api/health did not answer within 30s. Check \`pm2 logs ${APP_NAME}\`.`
		)
	);
	process.exitCode = 1;
}

// Moves the deployment onto the pm2 the just-installed CLI pins, then swaps the
// daemon. Without it a release that bumps pm2 needs `selva migrate` and
// `pm2 update` by hand on every host. Runs from the OLD CLI, so the pin is read
// from the new one on disk. The app is stopped here, so the swap costs no
// extra downtime. A failure leaves the old pm2 working: warn, don't abort.
function readPm2Pins(dir) {
	const read = (path) => {
		try {
			return JSON.parse(readFileSync(path, 'utf8'));
		} catch {
			return null;
		}
	};
	return {
		declared: read(join(dir, 'package.json'))?.dependencies?.pm2 ?? null,
		pinned:
			read(join(dir, 'node_modules', '@selvajs', 'cli', 'package.json'))?.devDependencies?.pm2 ??
			null
	};
}

function realignPm2Pin(dir, s) {
	const { declared, pinned } = readPm2Pins(dir);
	if (!pinned || pinned === declared) return;

	s.start(`npm install pm2@${pinned}`);
	try {
		execSync(`npm install --save --save-exact --prefer-online pm2@${pinned}`, {
			cwd: dir,
			stdio: 'pipe'
		});
		s.stop(`pm2 ${declared ?? '(none)'} → ${pinned}`);
	} catch (err) {
		s.stop(`npm install pm2@${pinned} failed`);
		p.log.warn(
			`${String(err.stderr ?? err.message ?? err).trim()}\n` +
				'The previous pm2 still runs the app. Retry with `npx selva migrate`.'
		);
		return;
	}
	try {
		ensurePm2InSync(dir);
	} catch (err) {
		p.log.warn(`${err instanceof Error ? err.message : err}`);
	}
}

// The app was stopped before the update, so the first answer is the new process.
async function waitForHealth(env, timeoutMs = 30_000) {
	const host = !env.HOST || env.HOST === '0.0.0.0' || env.HOST === '::' ? '127.0.0.1' : env.HOST;
	const url = `http://${host.includes(':') ? `[${host}]` : host}:${env.PORT || 3000}/api/health`;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
			if (res.ok) return { ok: true };
			return {
				ok: false,
				status: res.status,
				reason: degradedReason(await res.json().catch(() => null))
			};
		} catch {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	return { ok: false };
}

/** Names the cause a 503 from /api/health reports in `boot`. */
export function degradedReason(body) {
	const boot = body?.boot;
	if (boot?.schemaVersion?.ok === false) {
		return (
			boot.schemaVersion.message ??
			`database migration head ${boot.schemaVersion.actual} is behind ${boot.schemaVersion.expected}`
		);
	}
	if (boot?.atRestSecrets?.ok === false) {
		return 'stored compute API keys cannot be decrypted under the current SELVA_AT_REST_KEY';
	}
	return 'see `pm2 logs selva-compute`';
}

function readRuntimeVersion(dir) {
	try {
		const pkg = JSON.parse(
			readFileSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'), 'utf8')
		);
		return pkg.version;
	} catch {
		return undefined;
	}
}
