// `selva migrate` — bring an existing deployment onto the current layout.
//
// Three historical migrations exist for Selva deployments:
//   1. `@selvajs/create` → `@selvajs/cli`  (CLI bootstrap; can't be automated
//      since the operator has no `selva` binary yet — they run two npm
//      commands by hand from the Hotfix doc).
//   2. `@selvajs/runtime` → `@selvajs/selva`  (runtime bundling: UI, schemas,
//      ui-kit and the providers' workspace deps are now built into
//      @selvajs/selva).
//   3. selva.config.js → env-driven providers  (the picker logic moved into
//      the runtime; deployments no longer need a config file. Provider
//      packages are bundled into @selvajs/selva.)
//
// Migrate automates 2 and 3 together: it rewrites package.json, drops the
// now-bundled provider packages, removes any stale selva.config.js, and
// rewrites ecosystem.config.cjs if it still points at @selvajs/runtime.
//
// Future package-layout shifts go here too — the command should remain
// idempotent. On an already-current deployment it prints "nothing to
// migrate" and exits 0.
//
// Mirrors `selva update`'s lifecycle: stop pm2, mutate node_modules, start
// pm2 again with --update-env. Rollback restores package.json.bak on
// npm-install failure so the operator isn't left with a broken deployment.

import {
	existsSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	rmSync
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

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

	const sideFileChanges = [];
	if (hasStaleConfig) sideFileChanges.push(`${pc.red('-')} selva.config.js ${pc.dim('(no longer needed; providers are env-driven)')}`);
	if (ecoHasStaleRuntime) sideFileChanges.push(`${pc.yellow('~')} ecosystem.config.cjs ${pc.dim('(rewrite: @selvajs/runtime → @selvajs/selva)')}`);

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

	// Stop pm2 before mutating node_modules. Same reasoning as `selva update`:
	// SvelteKit's node adapter lazy-imports chunks, so swapping the build dir
	// under a live process causes ERR_MODULE_NOT_FOUND on in-flight requests.
	const stopStatus = runPm2(dir, ['stop', APP_NAME], { inherit: false });
	if (stopStatus !== 0) {
		p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
	}

	// Back up everything we're about to mutate. Restored on npm-install failure
	// so the operator isn't left with a half-migrated deployment.
	const bakPath = pkgPath + '.bak';
	copyFileSync(pkgPath, bakPath);
	writeFileSync(pkgPath, JSON.stringify(target, null, 2) + '\n', 'utf8');

	if (hasStaleConfig) {
		copyFileSync(configPath, configPath + '.bak');
		rmSync(configPath, { force: true });
	}

	if (ecoHasStaleRuntime) {
		copyFileSync(ecoPath, ecoPath + '.bak');
		// Single-line rewrite: only @selvajs/runtime → @selvajs/selva. We don't
		// regenerate from the canonical template here because the operator may
		// have customized port/memory/cluster settings; preserve their edits.
		const ecoContent = readFileSync(ecoPath, 'utf8').replace(
			/@selvajs\/runtime/g,
			'@selvajs/selva'
		);
		writeFileSync(ecoPath, ecoContent, 'utf8');
	}

	// Nuke node_modules + lockfile. A simple `npm install` won't always
	// resolve correctly when major version ranges change (e.g. runtime 0.10
	// → selva 2.0) — the lockfile pins old transitive deps that no longer
	// belong. Clean install is the only reliable path.
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
		// Try to bring the old process back up so we don't leave the operator
		// with downtime. If node_modules was wiped this won't help, but at
		// least package.json matches what's on disk.
		runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
		p.outro(pc.red(`Migration aborted: ${err.message ?? err}`));
		process.exit(1);
	}

	const status = runPm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
	const backupHints = ['package.json.bak'];
	if (hasStaleConfig) backupHints.push('selva.config.js.bak');
	if (ecoHasStaleRuntime) backupHints.push('ecosystem.config.cjs.bak');

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

// Compute what package.json should look like given the current contents.
//
// Wholesale-replace semantics: any @selvajs/* or pm2 entry not in our
// canonical set is dropped. Non-selva deps the operator added are also
// dropped — that's the design choice we made up-front.
//
// Provider packages (@selvajs/local-provider etc.) are NOT preserved even
// when the operator's .env selects them: they're bundled into @selvajs/selva
// in v2.1+ and the standalone packages are legacy. Providers are picked at
// runtime from SELVA_*_PROVIDER env vars.
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

// Produce human-readable diff lines for the confirmation prompt. Keep it
// short — the operator just needs to see what's moving, not a unified diff.
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

// Local copy of pm2.js's runner. Importing it would create a circular
// dependency via the `pm2.js` exports; pm2 invocation is small enough to
// duplicate.
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

// Exported for use by `selva doctor` so it can warn about layout drift
// without duplicating the detection logic.
export function detectDrift(pkgJson, dir) {
	const deps = pkgJson?.dependencies ?? {};
	const reasons = [];
	if (deps['@selvajs/runtime']) reasons.push('@selvajs/runtime is the old runtime package');
	if (deps['@selvajs/create']) reasons.push('@selvajs/create is the old CLI package');
	if (deps['@selvajs/platform']) reasons.push('@selvajs/platform is now bundled into @selvajs/selva');
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
	}

	return reasons;
}

// Re-exported so tests/imports can verify what migrate would write without
// actually running it.
export { buildTargetPackageJson, SELVA_DEPS };
