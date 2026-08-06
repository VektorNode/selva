// Migrate deployment to current layout: rewrite package.json (drop legacy
// provider packages), remove stale selva.config.js, update ecosystem.config.cjs.
// Idempotent; mirrors update's lifecycle (stop/mutate/start with rollback on failure).

import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import { renameEnvKeys, RENAMED_ENV_VARS } from '../env.js';
import {
	buildDeploymentPackageJson,
	DEPENDENCIES,
	LEGACY_DEPENDENCIES
} from '../deployment-package.js';
import { APP_NAME, runPm2 } from './pm2.js';

/**
 * Where `migrate` parks the old node_modules while npm installs the new one.
 * Left behind only if the process is killed mid-migration — `detectDrift`
 * reports it, because a stray copy of the dependency tree is both confusing and
 * large enough to matter on a small VM.
 */
export const NODE_MODULES_STASH = 'node_modules.selva-migrate-bak';

/**
 * @param {object} [deps] Seams for tests. The rollback path destroys and
 *   restores a real dependency tree, so it has to be exercised against a real
 *   directory — but not against a real npm or a real pm2 daemon.
 */
export async function runMigrate(
	_argv,
	{
		dir: injectedDir,
		// --prefer-online bypasses the stale-packument trap: npm can otherwise
		// resolve a cached packument that predates the release being migrated to.
		install = (cwd) => execSync('npm install --prefer-online', { cwd, stdio: 'pipe' }),
		confirm = (message) => p.confirm({ message, initialValue: true }),
		pm2 = runPm2
	} = {}
) {
	const dir = injectedDir ?? resolveDeploymentDir();
	requireDeploymentDir(dir);

	p.intro(pc.bgCyan(pc.black(' selva migrate ')));

	const pkgPath = join(dir, 'package.json');
	if (!existsSync(pkgPath)) {
		p.outro(pc.red('No package.json in this directory — nothing to migrate.'));
		process.exit(1);
	}

	const before = JSON.parse(readFileSync(pkgPath, 'utf8'));
	const target = buildTargetPackageJson(before);
	const pkgDiff = diffPackageJson(before, target);

	// Side-files: selva.config.js (now unused) and ecosystem.config.cjs
	// (must point at @selvajs/selva, not @selvajs/runtime).
	const configPath = join(dir, 'selva.config.js');
	const hasStaleConfig = existsSync(configPath);

	const ecoPath = join(dir, 'ecosystem.config.cjs');
	const ecoHasStaleRuntime =
		existsSync(ecoPath) && readFileSync(ecoPath, 'utf8').includes('@selvajs/runtime');

	// Deprecated env keys. The server reads the old names for one more minor
	// version, so this is a warning today and a silent fallback to defaults once
	// that shim goes — rewriting now is what keeps a tuned value tuned.
	const envPath = join(dir, '.env');
	const envBefore = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
	const envRename = envBefore
		? renameEnvKeys(envBefore, RENAMED_ENV_VARS)
		: { text: '', changes: [] };

	const sideFileChanges = [];
	if (hasStaleConfig)
		sideFileChanges.push(
			`${pc.red('-')} selva.config.js ${pc.dim('(no longer needed; providers are env-driven)')}`
		);
	if (ecoHasStaleRuntime)
		sideFileChanges.push(
			`${pc.yellow('~')} ecosystem.config.cjs ${pc.dim('(rewrite: @selvajs/runtime → @selvajs/selva)')}`
		);
	for (const [oldName, newName, action] of envRename.changes) {
		sideFileChanges.push(
			action === 'dropped'
				? `${pc.red('-')} .env ${pc.dim(`${oldName} (deprecated; ${newName} is already set)`)}`
				: `${pc.yellow('~')} .env ${pc.dim(`${oldName} → ${newName}`)}`
		);
	}

	if (pkgDiff.length === 0 && sideFileChanges.length === 0) {
		p.outro(pc.green('Already on the current layout — nothing to migrate.'));
		return;
	}

	p.log.info('Changes to apply:');
	for (const line of pkgDiff) console.log('  ' + line);
	for (const line of sideFileChanges) console.log('  ' + line);

	const confirmed = await confirm('Apply these changes, reinstall, and restart?');
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	// Stop pm2 before npm rewrites (SvelteKit lazy-loads chunks; see update command).
	// A legacy deployment may predate the local-pm2 layout, so a missing binary
	// is not fatal here — there is nothing running for us to stop.
	try {
		const stopStatus = pm2(dir, ['stop', APP_NAME], { inherit: false });
		if (stopStatus !== 0) {
			p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
		}
	} catch {
		p.log.warn('No deployment-local pm2 to stop — continuing.');
	}

	// Back up for rollback on npm-install failure.
	const bakPath = pkgPath + '.bak';
	copyFileSync(pkgPath, bakPath);
	writeFileSync(pkgPath, JSON.stringify(target, null, 2) + '\n', 'utf8');

	if (hasStaleConfig) {
		copyFileSync(configPath, configPath + '.bak');
		rmSync(configPath, { force: true });
	}

	if (ecoHasStaleRuntime) {
		copyFileSync(ecoPath, ecoPath + '.bak');
		// Rewrite @selvajs/runtime → @selvajs/selva only (preserve customizations).
		const ecoContent = readFileSync(ecoPath, 'utf8').replace(
			/@selvajs\/runtime/g,
			'@selvajs/selva'
		);
		writeFileSync(ecoPath, ecoContent, 'utf8');
	}

	if (envRename.changes.length > 0) {
		copyFileSync(envPath, envPath + '.bak');
		writeFileSync(envPath, envRename.text, 'utf8');
	}

	// A clean install is required — a legacy lockfile pins the old package set
	// across a major bump. But node_modules is also where pm2 lives, and the
	// rollback below has to restart the app, so deleting it outright leaves a
	// failed migration with no way back up. Rename instead: atomic, keeps the
	// .bin symlinks intact, and restorable until the install succeeds.
	const nodeModules = join(dir, 'node_modules');
	const nodeModulesBak = join(dir, NODE_MODULES_STASH);
	const lockPath = join(dir, 'package-lock.json');

	rmSync(nodeModulesBak, { recursive: true, force: true });
	if (existsSync(nodeModules)) renameSync(nodeModules, nodeModulesBak);
	const lockBak = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;
	rmSync(lockPath, { force: true });

	const s = p.spinner();
	s.start('Installing new dependencies (this can take a minute)');
	try {
		install(dir);
		s.stop('Dependencies installed');
		rmSync(nodeModulesBak, { recursive: true, force: true });
	} catch (err) {
		s.stop(pc.red('npm install failed — rolling back'));
		copyFileSync(bakPath, pkgPath);
		if (hasStaleConfig && existsSync(configPath + '.bak')) {
			copyFileSync(configPath + '.bak', configPath);
		}
		if (ecoHasStaleRuntime && existsSync(ecoPath + '.bak')) {
			copyFileSync(ecoPath + '.bak', ecoPath);
		}
		if (envRename.changes.length > 0 && existsSync(envPath + '.bak')) {
			copyFileSync(envPath + '.bak', envPath);
		}

		// Restore the dependency tree the app was running on. A half-installed
		// node_modules from the failed attempt is worse than the old one.
		rmSync(nodeModules, { recursive: true, force: true });
		if (existsSync(nodeModulesBak)) renameSync(nodeModulesBak, nodeModules);
		if (lockBak !== null) writeFileSync(lockPath, lockBak, 'utf8');

		restartAfterRollback(dir, pm2);
		p.outro(pc.red(`Migration aborted: ${err.message ?? err}`));
		process.exit(1);
	}

	let status;
	try {
		status = pm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
	} catch (err) {
		status = 1;
		p.log.error(`Could not invoke pm2: ${err instanceof Error ? err.message : err}`);
	}
	const backupHints = ['package.json.bak'];
	if (hasStaleConfig) backupHints.push('selva.config.js.bak');
	if (ecoHasStaleRuntime) backupHints.push('ecosystem.config.cjs.bak');
	if (envRename.changes.length > 0) backupHints.push('.env.bak');

	if (status === 0) {
		p.outro(
			[
				pc.green('Migration complete.'),
				pc.dim('Backups saved as ') + pc.cyan(backupHints.join(', ')),
				pc.dim('Run ') + pc.cyan('selva doctor') + pc.dim(' to verify.')
			].join('\n')
		);
	} else {
		p.outro(pc.yellow(`Migration applied but pm2 start failed — check \`pm2 logs ${APP_NAME}\`.`));
	}
}

/**
 * Bring the app back up after a failed migration.
 *
 * Never throws: the migration is already aborting, and an exception here would
 * replace the rollback's diagnosis with a stack trace. A failure to restart is
 * the operator's problem to act on, so it must be stated, not swallowed — the
 * old code returned a bare 1 and printed nothing.
 */
function restartAfterRollback(dir, pm2 = runPm2) {
	try {
		const status = pm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
		if (status === 0) {
			p.log.success(`Rolled back and restarted ${APP_NAME}.`);
			return;
		}
		p.log.error(
			`Rolled back, but \`pm2 start\` exited ${status}. The app may be down — ` +
				`check \`pm2 logs ${APP_NAME}\` and start it with \`selva start\`.`
		);
	} catch (err) {
		p.log.error(
			`Rolled back, but pm2 could not be invoked (${err instanceof Error ? err.message : err}). ` +
				`The app is likely down — run \`npm install\` then \`selva start\`.`
		);
	}
}

function buildTargetPackageJson(current) {
	return buildDeploymentPackageJson({
		name: current.name ?? 'selva-deployment',
		version: current.version ?? '0.1.0'
	});
}

// Format package.json diff for confirmation prompt (concise, not full diff).
function diffPackageJson(before, after) {
	const lines = [];

	const beforeDeps = before.dependencies ?? {};
	const afterDeps = after.dependencies ?? {};

	const allNames = new Set([...Object.keys(beforeDeps), ...Object.keys(afterDeps)]);
	for (const name of [...allNames].sort()) {
		const a = beforeDeps[name];
		const b = afterDeps[name];
		if (a && !b) lines.push(`${pc.red('-')} ${name} ${pc.dim(a)}`);
		else if (!a && b) lines.push(`${pc.green('+')} ${name} ${pc.dim(b)}`);
		else if (a !== b) lines.push(`${pc.yellow('~')} ${name} ${pc.dim(a + ' → ' + b)}`);
	}

	const beforeScripts = before.scripts ?? {};
	const afterScripts = after.scripts ?? {};
	const allScripts = new Set([...Object.keys(beforeScripts), ...Object.keys(afterScripts)]);
	for (const name of [...allScripts].sort()) {
		const a = beforeScripts[name];
		const b = afterScripts[name];
		if (a !== b) {
			if (a && !b) lines.push(`${pc.red('-')} script.${name} ${pc.dim(a)}`);
			else if (!a && b) lines.push(`${pc.green('+')} script.${name} ${pc.dim(b)}`);
			else lines.push(`${pc.yellow('~')} script.${name} ${pc.dim(a + ' → ' + b)}`);
		}
	}

	return lines;
}

// Exported for `selva doctor` to check layout drift without duplication.
export function detectDrift(pkgJson, dir) {
	const deps = pkgJson?.dependencies ?? {};
	const reasons = [];

	for (const [name, why] of Object.entries(LEGACY_DEPENDENCIES)) {
		if (deps[name]) reasons.push(`${name} is ${why}`);
	}
	for (const name of Object.keys(DEPENDENCIES)) {
		if (!deps[name]) reasons.push(`${name} is missing`);
	}

	if (dir) {
		const configPath = join(dir, 'selva.config.js');
		if (existsSync(configPath)) {
			reasons.push('selva.config.js is no longer needed (providers are env-driven)');
		}
		const ecoPath = join(dir, 'ecosystem.config.cjs');
		if (existsSync(ecoPath) && readFileSync(ecoPath, 'utf8').includes('@selvajs/runtime')) {
			reasons.push('ecosystem.config.cjs still references @selvajs/runtime');
		}
		const envPath = join(dir, '.env');
		if (existsSync(envPath)) {
			const { changes } = renameEnvKeys(readFileSync(envPath, 'utf8'), RENAMED_ENV_VARS);
			for (const [oldName, newName] of changes) {
				reasons.push(`.env still uses ${oldName} (renamed to ${newName})`);
			}
		}
	}

	return reasons;
}

export { buildTargetPackageJson };
