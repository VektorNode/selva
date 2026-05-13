// Thin wrappers around PM2 commands. The point isn't to abstract pm2 —
// it's to hide footguns the docs already warn about:
//
//   • `pm2 restart` without --update-env silently keeps the old env, even
//     after the operator edited .env. We always pass --update-env.
//
//   • The PM2 binary may live in node_modules/.bin (project-local install)
//     or globally. We resolve to the local one first so a fresh deployment
//     works without `npm i -g pm2`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

const APP_NAME = 'selva-compute';

function pm2Bin(dir) {
	const local = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'pm2.cmd' : 'pm2');
	if (existsSync(local)) return local;
	return 'pm2'; // fall back to PATH
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
				`Install pm2 with \`npm install pm2\` in this directory.`
		);
	}
	return result.status ?? 0;
}

export async function runStart() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	const exit = runPm2(dir, ['start', 'ecosystem.config.cjs']);
	process.exit(exit);
}

export async function runStop() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	const exit = runPm2(dir, ['stop', APP_NAME]);
	process.exit(exit);
}

export async function runRestart() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
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
	p.log.info(`Current @selvajs/runtime: ${before ?? 'unknown'}`);

	// All @selvajs/* packages move in lockstep so provider-only fixes and CLI
	// fixes get picked up even when the runtime version hasn't moved. The
	// admin-center button runs the same list — keep them in sync if you edit.
	const packages = [
		'@selvajs/create',
		'@selvajs/runtime',
		'@selvajs/platform',
		'@selvajs/local-provider',
		'@selvajs/supabase-provider',
		'@selvajs/header-auth-provider'
	];

	const confirmed = await p.confirm({
		message: 'Refresh all @selvajs/* packages and restart the app?',
		initialValue: true
	});
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	const s = p.spinner();
	s.start(`npm update ${packages.join(' ')}`);
	try {
		execSync(`npm update --save ${packages.join(' ')}`, { cwd: dir, stdio: 'pipe' });
		s.stop('npm update finished');
	} catch (err) {
		s.stop('npm update failed');
		throw err;
	}

	const after = readRuntimeVersion(dir);
	p.log.info(`New @selvajs/runtime:     ${after ?? 'unknown'}`);

	// Try to restart. If pm2 isn't running this app, skip.
	const status = runPm2(dir, ['restart', APP_NAME, '--update-env'], { inherit: false });
	if (status === 0) {
		p.outro(pc.green('Restarted ' + APP_NAME));
	} else {
		p.outro(pc.yellow(`Restart skipped — start with \`selva start\`.`));
	}
}

function readRuntimeVersion(dir) {
	try {
		const pkg = JSON.parse(
			readFileSync(join(dir, 'node_modules', '@selvajs', 'runtime', 'package.json'), 'utf8')
		);
		return pkg.version;
	} catch {
		return undefined;
	}
}
