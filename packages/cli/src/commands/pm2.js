// Thin wrappers around PM2 commands. The point isn't to abstract pm2 —
// it's to hide footguns the docs already warn about:
//
//   • `pm2 restart` without --update-env silently keeps the old env, even
//     after the operator edited .env. We always pass --update-env.
//
//   • The PM2 binary may live in node_modules/.bin (project-local install)
//     or globally. We resolve to the local one first so a fresh deployment
//     works without `npm i -g pm2`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
