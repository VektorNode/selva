// Thin wrappers around PM2 commands. The point isn't to abstract pm2 —
// it's to hide footguns the docs already warn about:
//
//   • `pm2 restart` without --update-env silently keeps the old env, even
//     after the operator edited .env. We always pass --update-env.
//
//   • PM2's daemon and CLI must be the same version. The daemon is sticky:
//     once forked it runs that version forever, regardless of what the on-
//     disk binary later becomes. We resolve pm2 to ONE binary (the project-
//     local one) so every command — interactive, scripted, admin endpoint —
//     hits the same code path. If a different pm2 ever started the daemon
//     (e.g. a stray `npm i -g pm2`), `ensurePm2InSync` detects the skew
//     and runs `pm2 update` to respawn the daemon under our binary.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

const APP_NAME = 'selva-compute';

// Resolve pm2 to the deployment's own copy. NO global fallback — having two
// pm2 binaries on the same host and letting them both manage the daemon
// produces the exact version-skew bug this wrapper exists to prevent.
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

// Check whether the in-memory PM2 daemon was forked by a different pm2 than
// the one we're about to invoke. PM2 prints "In-memory PM2 is out-of-date" on
// every command in that state and process operations may stall. `pm2 update`
// is the only fix: dump → kill daemon → respawn under the current binary →
// resurrect dump. We run it here before any state-changing command so the
// caller never gets a half-applied stop/restart against a stale daemon.
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

	// Resync the daemon BEFORE we touch the running app — if the daemon is a
	// different version than the local CLI, `pm2 stop` may report success
	// while leaving the process group in a half-state, and the subsequent
	// `pm2 start` then hangs. Running `pm2 update` here puts everything on
	// the same version (and survives the dump+resurrect cycle).
	ensurePm2InSync(dir);

	// Stop the running process BEFORE npm rewrites node_modules/@selvajs/selva/build/.
	// SvelteKit's node adapter lazy-imports chunks from build/server/chunks/ on every
	// request; if we let npm replace them while the old process is still serving
	// traffic, in-flight requests hit ERR_MODULE_NOT_FOUND for chunks whose hash
	// just changed. Brief downtime (~1-2s longer than restart-in-place) but no
	// chunk-mismatch errors.
	const stopStatus = runPm2(dir, ['stop', APP_NAME], { inherit: false });
	if (stopStatus !== 0) {
		p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
	}

	const s = p.spinner();
	s.start(`npm update ${packages.join(' ')}`);
	try {
		// --prefer-online forces npm to revalidate cached packuments against
		// the registry before using them. Without this, npm's 5+ minute
		// packument cache silently re-installs the same version even when a
		// newer one was published in the meantime. See docs/Hotfix-CLI-Runtime.md
		// "The stale-packument-cache trap".
		execSync(`npm update --save --prefer-online ${packages.join(' ')}`, {
			cwd: dir,
			stdio: 'pipe'
		});
		s.stop('npm update finished');
	} catch (err) {
		s.stop('npm update failed');
		// Bring the old process back up so the operator isn't left with downtime.
		runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
		throw err;
	}

	const after = readRuntimeVersion(dir);
	p.log.info(`New @selvajs/selva:     ${after ?? 'unknown'}`);

	// Surface no-op updates explicitly. --prefer-online closes most cache
	// holes, but a freshly-published version can take a minute or two to
	// propagate through npm's CDN — operators who run update too quickly
	// after publish still see "Current = New". Tell them how to retry.
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
