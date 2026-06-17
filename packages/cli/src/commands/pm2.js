// Thin wrappers around PM2 commands: always pass --update-env (ignore edits),
// resolve to deployment-local pm2 (avoid daemon version skew with global install),
// and resync daemon before state changes.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

const APP_NAME = 'selva-compute';

// Resolve to deployment-local pm2 (no global fallback; prevents version skew).
function pm2Bin(dir) {
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

// Check for daemon/CLI version mismatch; run `pm2 update` if stale.
function ensurePm2InSync(dir) {
	const bin = pm2Bin(dir);
	const probe = spawnSync(bin, ['ping'], {
		cwd: dir,
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});
	const output = (probe.stdout ?? '') + (probe.stderr ?? '');
	if (!/out-of-date/i.test(output)) return;

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

function runPm2(dir, args, { inherit = true } = {}) {
	const bin = pm2Bin(dir);
	const result = spawnSync(bin, args, {
		cwd: dir,
		stdio: inherit ? 'inherit' : 'pipe',
		shell: process.platform === 'win32' // allow .cmd shim resolution
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

	// Providers are bundled into @selvajs/selva — the only @selvajs/* packages
	// an operator install carries are the runtime and the CLI. The admin-center
	// "Run update" button runs the same list — keep them in sync if you edit.
	const packages = ['@selvajs/cli', '@selvajs/selva'];

	const confirmed = await p.confirm({
		message: 'Refresh all @selvajs/* packages and restart the app?',
		initialValue: true
	});
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	// Resync daemon before state changes (avoid half-state stop/start).
	ensurePm2InSync(dir);

	// Stop before npm rewrites (SvelteKit lazy-loads chunks; see migrate command).
	const stopStatus = runPm2(dir, ['stop', APP_NAME], { inherit: false });
	if (stopStatus !== 0) {
		p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
	}

	const s = p.spinner();
	s.start(`npm update ${packages.join(' ')}`);
	try {
		// --prefer-online bypasses npm's packument cache (see docs/Hotfix-CLI-Runtime.md).
		execSync(`npm update --save --prefer-online ${packages.join(' ')}`, {
			cwd: dir,
			stdio: 'pipe'
		});
		s.stop('npm update finished');
	} catch (err) {
		s.stop('npm update failed');
		// Best-effort: bring old process back up.
		runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
		throw err;
	}

	const after = readRuntimeVersion(dir);
	p.log.info(`New @selvajs/selva:     ${after ?? 'unknown'}`);

	// Surface no-op updates (cache may be stale; propagation delay is real).
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

	// Start the new build under PM2.
	const status = runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
	if (status === 0) {
		p.outro(pc.green('Started ' + APP_NAME));
	} else {
		p.outro(pc.yellow(`Start failed — investigate with \`pm2 logs ${APP_NAME}\`.`));
	}
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
