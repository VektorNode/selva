// Migrate deployment to current layout: rewrite package.json (drop legacy
// provider packages), remove stale selva.config.js, update ecosystem.config.cjs.
// Idempotent; mirrors update's lifecycle (stop/mutate/start with rollback on failure).

import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import { renameEnvKeys, RENAMED_ENV_VARS } from '../env.js';

const APP_NAME = 'selva-compute';

// Packages we own. Everything in this set is rewritten wholesale by migrate;
// anything outside it (operator's own deps) gets dropped, which is the
// explicit design choice — operators with custom deps should fork the
// template rather than hand-patch the deployment package.json.
const SELVA_DEPS = new Set([
	'@selvajs/cli',
	'@selvajs/selva',
	'@selvajs/runtime', // legacy — removed during migrate
	'@selvajs/platform', // legacy — bundled into @selvajs/selva
	'@selvajs/local-provider', // legacy — bundled into @selvajs/selva
	'@selvajs/supabase-provider', // legacy — bundled into @selvajs/selva
	'@selvajs/header-auth-provider', // legacy — bundled into @selvajs/selva
	'@selvajs/create' // legacy CLI — removed during migrate
]);

const CANONICAL_SCRIPTS = {
	start: 'selva start',
	stop: 'selva stop',
	restart: 'selva restart',
	logs: 'selva logs',
	doctor: 'selva doctor',
	update: 'selva update'
};

export async function runMigrate() {
	const dir = resolveDeploymentDir();
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

	const confirmed = await p.confirm({
		message: 'Apply these changes, reinstall, and restart?',
		initialValue: true
	});
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	// Stop pm2 before npm rewrites (SvelteKit lazy-loads chunks; see update command).
	const stopStatus = runPm2(dir, ['stop', APP_NAME], { inherit: false });
	if (stopStatus !== 0) {
		p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
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

	// Clean install required (major version changes break legacy lockfile).
	rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
	rmSync(join(dir, 'package-lock.json'), { force: true });

	const s = p.spinner();
	s.start('Installing new dependencies (this can take a minute)');
	try {
		// --prefer-online to bypass the stale-packument trap documented in
		// docs/Hotfix-CLI-Runtime.md.
		execSync('npm install --prefer-online', {
			cwd: dir,
			stdio: 'pipe'
		});
		s.stop('Dependencies installed');
	} catch (err) {
		s.stop(pc.red('npm install failed — rolling back package.json'));
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
		// Try to bring the process back up (best-effort; at least package.json is consistent).
		runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
		p.outro(pc.red(`Migration aborted: ${err.message ?? err}`));
		process.exit(1);
	}

	const status = runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
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

// Build target package.json with canonical dependencies (wholesale replace).
// Drops non-canonical @selvajs/* and operator's own deps (by design).
function buildTargetPackageJson(current) {
	const deps = {
		'@selvajs/cli': 'latest',
		'@selvajs/selva': 'latest',
		pm2: '^5.4.0'
	};

	return {
		name: current.name ?? 'selva-deployment',
		version: current.version ?? '0.1.0',
		private: true,
		type: 'module',
		scripts: { ...CANONICAL_SCRIPTS },
		dependencies: deps
	};
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

// Local pm2 runner (avoid circular dep; duplication is small).
function runPm2(dir, args, { inherit = true } = {}) {
	const local = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'pm2.cmd' : 'pm2');
	const bin = existsSync(local) ? local : 'pm2';
	const result = spawnSync(bin, args, {
		cwd: dir,
		stdio: inherit ? 'inherit' : 'pipe',
		shell: process.platform === 'win32'
	});
	if (result.error) return 1;
	return result.status ?? 0;
}

// Exported for `selva doctor` to check layout drift without duplication.
export function detectDrift(pkgJson, dir) {
	const deps = pkgJson?.dependencies ?? {};
	const reasons = [];
	if (deps['@selvajs/runtime']) reasons.push('@selvajs/runtime is the old runtime package');
	if (deps['@selvajs/create']) reasons.push('@selvajs/create is the old CLI package');
	if (deps['@selvajs/platform'])
		reasons.push('@selvajs/platform is now bundled into @selvajs/selva');
	if (deps['@selvajs/local-provider'])
		reasons.push('@selvajs/local-provider is now bundled into @selvajs/selva');
	if (deps['@selvajs/supabase-provider'])
		reasons.push('@selvajs/supabase-provider is now bundled into @selvajs/selva');
	if (deps['@selvajs/header-auth-provider'])
		reasons.push('@selvajs/header-auth-provider is now bundled into @selvajs/selva');
	if (!deps['@selvajs/selva']) reasons.push('@selvajs/selva is missing');
	if (!deps['@selvajs/cli']) reasons.push('@selvajs/cli is missing');
	if (!deps['pm2']) reasons.push('pm2 is not in dependencies');

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

// Re-exported for tests to verify without running migrate.
export { buildTargetPackageJson, SELVA_DEPS };
