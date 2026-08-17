// Migrates a deployment to the current layout: rewrites package.json (drops legacy
// provider packages), removes stale selva.config.js, updates ecosystem.config.cjs.
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
	CANONICAL_FIELDS,
	DEPENDENCIES,
	isFloatingPin,
	LEGACY_DEPENDENCIES,
	needsSupabaseProvider,
	npmDistTagVersion,
	OVERRIDES,
	resolveSelvaPins,
	SELVA_PACKAGES
} from '../deployment-package.js';
import { APP_NAME, runPm2 } from './pm2.js';

// Where migrate parks the old node_modules while npm installs the new one.
// Left behind only if the process is killed mid-migration; `selva doctor`
// flags a surviving stash as an interrupted migration.
export const NODE_MODULES_STASH = 'node_modules.selva-migrate-bak';

// Matches the backups migrate writes: `.env.2026-08-10T05-43-12.bak`. Anchored
// at both ends so an operator's own `notes.bak` is never picked up as ours.
export const BACKUP_PATTERN = /\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.bak$/;

/**
 * Colons are illegal in Windows filenames, so this is ISO with `:` swapped for
 * `-` and the fractional seconds dropped: 2026-08-10T05-43-12.
 */
export function backupStamp(now = new Date()) {
	return now
		.toISOString()
		.replace(/\.\d+Z$/, '')
		.replace(/:/g, '-');
}

/**
 * A migration used to write `package.json.bak` at a fixed path, so the second
 * substantive migration overwrote the first's copy — and since each run backs
 * up the *current* file, that left the operator's original config recoverable
 * from nowhere (#184). One stamp per run keeps a whole migration's backups
 * together and makes them sortable.
 *
 * Not auto-pruned here: deleting an operator's only copy of their old config is
 * worse than a few small files accumulating. `selva doctor` reports aged ones
 * with a `--fix`, which keeps the decision theirs.
 */
export function backupPathFor(filePath, stamp) {
	return `${filePath}.${stamp}.bak`;
}

// Old enough that the migration which wrote it is long settled.
export const BACKUP_AGE_DAYS = 30;

/**
 * Split migration backups into what to keep and what `doctor --fix` may delete.
 *
 * The newest run's backups are always kept, however old they are — on a
 * deployment that migrates once a year, age alone would delete the only copy of
 * the pre-migration config, which is the whole point of keeping them. So the
 * rule is: keep the newest stamp, offer to delete stamps older than
 * `BACKUP_AGE_DAYS`.
 *
 * `names` are basenames; the stamp is read from the filename rather than mtime,
 * which a copy or restore would reset.
 */
export function classifyBackups(names, now = new Date(), maxAgeDays = BACKUP_AGE_DAYS) {
	const found = [];
	for (const name of names) {
		const m = BACKUP_PATTERN.exec(name);
		if (m) found.push({ name, stamp: m[1] });
	}
	if (found.length === 0) return { keep: [], aged: [], newest: null };

	// Stamps are fixed-width and zero-padded, so lexical order is chronological.
	const newest = found.reduce((a, b) => (b.stamp > a.stamp ? b : a)).stamp;
	const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;

	const keep = [];
	const aged = [];
	for (const entry of found) {
		// `2026-08-10T05-43-12` → parseable by restoring the colons.
		const at = Date.parse(entry.stamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z');
		if (entry.stamp === newest || !Number.isFinite(at) || at >= cutoff) keep.push(entry.name);
		else aged.push(entry.name);
	}
	return { keep, aged, newest };
}

// `deps` are seams for tests: the rollback path destroys and restores a real
// dependency tree, so it has to run against a real directory — but not against
// a real npm or pm2 daemon.
export async function runMigrate(
	_argv,
	{
		dir: injectedDir,
		// --prefer-online: npm can otherwise resolve a cached packument that
		// predates the release being migrated to.
		install = (cwd) => execSync('npm install --prefer-online', { cwd, stdio: 'pipe' }),
		confirm = (message) => p.confirm({ message, initialValue: true }),
		pm2 = runPm2,
		resolveVersion = npmDistTagVersion
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
	const deploymentEnv = readDeploymentEnv(join(dir, '.env'));
	const { pkg: target, notes: pinNotes } = buildTargetPackageJson(
		before,
		resolveVersion,
		deploymentEnv
	);
	const pkgDiff = diffPackageJson(before, target);

	const configPath = join(dir, 'selva.config.js');
	const hasStaleConfig = existsSync(configPath);

	const ecoPath = join(dir, 'ecosystem.config.cjs');
	const ecoHasStaleRuntime =
		existsSync(ecoPath) && readFileSync(ecoPath, 'utf8').includes('@selvajs/runtime');

	// The server drops its read-old-name shim after one minor version, so
	// rewriting now is what keeps a tuned value tuned instead of silently
	// reverting to defaults later.
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

	// The diff shows the pin that will be written; these explain why it is that
	// pin. A preserved beta and a pin that couldn't be resolved both look like
	// "no change" in the diff, and the second one is a stale pin, not a stable one.
	for (const note of pinNotes) {
		if (note.kind === 'prerelease') {
			p.log.info(
				`${note.name} stays on ${note.pin} — a prerelease pin is kept, since \`latest\` ` +
					`means newest stable and would move this deployment backwards.`
			);
		} else {
			p.log.warn(
				`Could not resolve the current version of ${note.name} (${note.reason}). ` +
					`Keeping ${JSON.stringify(note.pin ?? null)}; re-run migrate when the registry is reachable.`
			);
		}
	}

	const confirmed = await confirm('Apply these changes, reinstall, and restart?');
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	// Stop pm2 before npm rewrites — SvelteKit lazy-loads chunks, so a rewrite
	// under a running server serves a broken page (same reason `update` stops first).
	// A legacy deployment may predate the local-pm2 layout, so a missing binary
	// isn't fatal here: there's nothing running for us to stop.
	try {
		const stopStatus = pm2(dir, ['stop', APP_NAME], { inherit: false });
		if (stopStatus !== 0) {
			p.log.warn('pm2 stop did not succeed — selva-compute may not be running. Continuing.');
		}
	} catch {
		p.log.warn('No deployment-local pm2 to stop — continuing.');
	}

	// One stamp for the whole run, so a migration's backups sort together and a
	// later migration cannot overwrite this one's (#184).
	const stamp = backupStamp();
	const bakPath = backupPathFor(pkgPath, stamp);
	const configBak = backupPathFor(configPath, stamp);
	const ecoBak = backupPathFor(ecoPath, stamp);
	const envBak = backupPathFor(envPath, stamp);

	copyFileSync(pkgPath, bakPath);
	writeFileSync(pkgPath, JSON.stringify(target, null, 2) + '\n', 'utf8');

	if (hasStaleConfig) {
		copyFileSync(configPath, configBak);
		rmSync(configPath, { force: true });
	}

	if (ecoHasStaleRuntime) {
		copyFileSync(ecoPath, ecoBak);
		// Text substitution, not regeneration, so any operator customizations to the file survive.
		const ecoContent = readFileSync(ecoPath, 'utf8').replace(
			/@selvajs\/runtime/g,
			'@selvajs/selva'
		);
		writeFileSync(ecoPath, ecoContent, 'utf8');
	}

	if (envRename.changes.length > 0) {
		copyFileSync(envPath, envBak);
		writeFileSync(envPath, envRename.text, 'utf8');
	}

	// A legacy lockfile pins the old package set across a major bump, so this needs
	// a clean install. But node_modules is also where pm2 lives, and rollback has to
	// restart the app — deleting it outright would leave a failed migration with no
	// way back up. Rename instead: atomic, keeps .bin symlinks intact, restorable
	// until the install succeeds.
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
		if (hasStaleConfig && existsSync(configBak)) {
			copyFileSync(configBak, configPath);
		}
		if (ecoHasStaleRuntime && existsSync(ecoBak)) {
			copyFileSync(ecoBak, ecoPath);
		}
		if (envRename.changes.length > 0 && existsSync(envBak)) {
			copyFileSync(envBak, envPath);
		}

		// A half-installed node_modules from the failed attempt is worse than the old
		// one, so clear it before restoring the stash.
		rmSync(nodeModules, { recursive: true, force: true });
		if (existsSync(nodeModulesBak)) renameSync(nodeModulesBak, nodeModules);
		if (lockBak !== null) writeFileSync(lockPath, lockBak, 'utf8');

		restartAfterRollback(dir, pm2);
		p.outro(pc.red(`Migration aborted: ${err.message ?? err}`));
		process.exit(1);
	}

	// Migration itself already succeeded at this point, so a failed pm2 start is reported
	// but doesn't exit non-zero or trigger rollback — the on-disk state is fine, only the
	// running process isn't. Contrast restartAfterRollback, which does exit 1: that path
	// runs after a rollback, where a failed restart leaves nothing serving traffic at all.
	let status;
	try {
		status = pm2(dir, ['start', APP_NAME, '--update-env'], { inherit: false });
	} catch (err) {
		status = 1;
		p.log.error(`Could not invoke pm2: ${err instanceof Error ? err.message : err}`);
	}
	// A pin change means the just-installed pm2 CLI and the still-running
	// daemon are now different versions. That's the repairable skew direction
	// (daemon older), but it stays skewed until the operator acts — say so
	// here, once, instead of letting doctor nag forever. Deliberately NOT
	// automated: `pm2 update` recycles the daemon, and doing that unattended
	// inside a migration converts a mid-flight failure into an outage (see
	// plans/fixes/host-prerequisites-and-pm2-audit.md).
	const pm2Notice = buildPm2UpgradeNotice(before.dependencies?.pm2, target.dependencies.pm2);
	if (pm2Notice) p.log.warn(pm2Notice);

	const backupHints = [`package.json.${stamp}.bak`];
	if (hasStaleConfig) backupHints.push(`selva.config.js.${stamp}.bak`);
	if (ecoHasStaleRuntime) backupHints.push(`ecosystem.config.cjs.${stamp}.bak`);
	if (envRename.changes.length > 0) backupHints.push(`.env.${stamp}.bak`);

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

// Never throws: the migration is already aborting, and an exception here would
// replace the rollback's diagnosis with a stack trace. A failure to restart is
// the operator's problem to act on, so it gets logged, not swallowed.
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

// Only the provider keys matter here, so this reads `KEY=value` lines rather
// than pulling in a dotenv parser: no quoting, expansion, or multi-line values
// to honour.
function readDeploymentEnv(envPath) {
	if (!existsSync(envPath)) return {};
	const env = {};
	for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
	}
	return env;
}

function buildTargetPackageJson(current, resolveVersion = npmDistTagVersion, env = {}) {
	const supabase = needsSupabaseProvider(env);
	const { pins, notes } = resolveSelvaPins(
		current.dependencies,
		resolveVersion,
		supabase ? ['@selvajs/supabase-provider'] : []
	);
	const pkg = buildDeploymentPackageJson({
		name: current.name ?? 'selva-deployment',
		version: current.version ?? '0.1.0',
		engines: current.engines,
		dependencies: pins,
		supabase
	});
	return { pkg, notes };
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

	// Without this section, an overrides-only change reads as "already on the
	// current layout" and the security shim never reaches existing deployments.
	const beforeOverrides = before.overrides ?? {};
	const afterOverrides = after.overrides ?? {};
	const allOverrides = new Set([...Object.keys(beforeOverrides), ...Object.keys(afterOverrides)]);
	for (const name of [...allOverrides].sort()) {
		const a = beforeOverrides[name];
		const b = afterOverrides[name];
		if (a && !b) lines.push(`${pc.red('-')} overrides.${name} ${pc.dim(a)}`);
		else if (!a && b) lines.push(`${pc.green('+')} overrides.${name} ${pc.dim(b)}`);
		else if (a !== b) lines.push(`${pc.yellow('~')} overrides.${name} ${pc.dim(a + ' → ' + b)}`);
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

	// Anything outside the canonical set is discarded by the rewrite — show it here
	// too, or the operator confirms a change (e.g. losing devDependencies) they
	// never saw.
	for (const key of Object.keys(before).sort()) {
		if (CANONICAL_FIELDS.has(key)) continue;
		lines.push(`${pc.red('-')} ${key} ${pc.dim(summarize(before[key]))}`);
	}

	return lines;
}

// One-line preview of a dropped field, enough to recognise what is being lost.
function summarize(value) {
	if (value === null || typeof value !== 'object') return String(value);
	const keys = Object.keys(value);
	if (Array.isArray(value)) return `[${keys.length} item${keys.length === 1 ? '' : 's'}]`;
	return keys.length ? `{${keys.join(', ')}}` : '{}';
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

	// pm2 is the one dependency pinned exactly, so a version difference is drift
	// rather than an operator preference. Presence alone was checked above and
	// isn't enough: a deployment scaffolded against an older CLI keeps its old
	// pm2 forever, which is how the pin reached a two-major gap unnoticed.
	if (deps.pm2 && deps.pm2 !== DEPENDENCIES.pm2) {
		reasons.push(`pm2 is pinned to ${deps.pm2} (current scaffold pins ${DEPENDENCIES.pm2})`);
	}

	// A stored dist-tag re-resolves on every `npm install`, so the deployment
	// follows the tag instead of a version an operator chose. Worse on a
	// prerelease line, where `latest` points at the older stable release and the
	// "upgrade" is a downgrade. Migrate wrote these before it learned to resolve
	// tags, so existing deployments carry one and nothing else reports it.
	for (const name of SELVA_PACKAGES) {
		if (deps[name] && isFloatingPin(deps[name])) {
			reasons.push(
				`${name} is pinned to the floating tag ${JSON.stringify(deps[name])} ` +
					`(re-resolves on every install; migrate writes a concrete version)`
			);
		}
	}

	// Overrides are security shims for vulnerable transitive deps — a
	// deployment without them installs the vulnerable version on its next
	// `npm install`, silently.
	for (const [name, version] of Object.entries(OVERRIDES)) {
		if (pkgJson?.overrides?.[name] !== version) {
			reasons.push(`overrides.${name} is missing or outdated (security shim, expects ${version})`);
		}
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

// Null when the pin didn't change. Exported for its test — the wording is the
// operator's only pointer to finish the upgrade.
export function buildPm2UpgradeNotice(beforeVersion, afterVersion) {
	if (!beforeVersion || beforeVersion === afterVersion) return null;
	return [
		`pm2 was upgraded ${beforeVersion} → ${afterVersion}, but the running pm2 daemon is`,
		`still the old version. Finish the upgrade (brief restart of managed processes):`,
		``,
		`  npx pm2 update`,
		`  npx pm2 list          # ${APP_NAME} must be listed and 'online' before the next step`,
		`  npx pm2 save`,
		``,
		`Do not run \`pm2 save\` until the list looks right. \`pm2 update\` empties the`,
		`process table before restoring it, so saving a failed restore overwrites`,
		`~/.pm2/dump.pm2 — the only record of what to bring back. If the list is empty,`,
		`recover with \`npx pm2 resurrect\`, or \`npx pm2 start ecosystem.config.cjs\`.`,
		``,
		`If doctor reports a pm2 outside this deployment (global or apt install), follow`,
		`the full procedure in the docs instead: self-hosting → deployment → prerequisites.`
	].join('\n');
}

export { buildTargetPackageJson, diffPackageJson };
