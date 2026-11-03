// `selva config show|set|unset`: what this deployment's .env sets, checked
// against the manifest the runtime declares.

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { parseEnv, setEnvValues, writeEnvText } from '../env.js';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import {
	ALL_SETTINGS,
	deploymentReport,
	deploymentSnapshot,
	diffSnapshots,
	resolveConfig
} from '../generated/config.js';
import { backupPathFor, backupStamp } from './migrate.js';

export const SNAPSHOT_FILE = '.selva-config-snapshot.json';

/** The same report the app builds for /admin/system. */
export const reportFor = deploymentReport;

/**
 * How `.env` differs from what the app last booted with. Non-empty means it
 * was edited without a restart, or something (pm2's saved env, compose)
 * overrides it.
 */
export function driftFromLastBoot(dir, env) {
	const path = join(dir, SNAPSHOT_FILE);
	if (!existsSync(path)) return null;
	let snapshot;
	try {
		snapshot = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
	return diffSnapshots(snapshot, deploymentSnapshot(env, snapshot.salt));
}

/** Validate one KEY=VALUE against the manifest. Returns the spec, or an error message. */
export function checkSetting(key, value) {
	const spec = ALL_SETTINGS.find((s) => s.key === key);
	if (!spec) {
		const alias = ALL_SETTINGS.find((s) => s.aliases?.includes(key));
		return {
			error: alias
				? `${key} was renamed to ${alias.key}.`
				: `${key} is not a setting Selva reads. \`selva config show --all\` lists them.`
		};
	}
	// Setting a key by hand skips _PREVIOUS and breaks what it protected.
	if (spec.class === 'secret' && spec.generated) {
		const target = key.startsWith('SELVA_HMAC_KEY') ? 'hmac' : 'at-rest';
		return {
			error: `${key} is replaced with \`selva keys rotate ${target}\`, which keeps the old key working.`
		};
	}
	const report = resolveConfig([spec], { [key]: value }).keys[key];
	if (report.status !== 'ok') return { error: `${key} ${report.problem}.` };
	return { spec };
}

function printRow(row) {
	const value = row.display === '' ? pc.dim('—') : row.display;
	const source =
		row.source === 'default'
			? pc.dim('default')
			: row.source === 'unset'
				? pc.dim('not set')
				: row.source === 'alias'
					? pc.yellow(`from ${row.alias}`)
					: '.env';
	const mark =
		row.status === 'error' ? pc.red('✗') : row.status === 'invalid' ? pc.yellow('!') : ' ';
	console.log(`${mark} ${row.key.padEnd(36)} ${String(value).padEnd(30)} ${source}`);
	if (row.problem) console.log(`    ${pc.red(`value ${row.problem}`)}`);
}

export async function runConfig(argv) {
	const [sub, ...rest] = argv;
	if (sub === 'show' || sub === undefined) return runShow(rest);
	if (sub === 'set') return runSet(rest);
	if (sub === 'unset') return runUnset(rest);
	console.error('Usage: selva config <show [--all] | set KEY=VALUE | unset KEY>');
	process.exit(1);
}

function readDeploymentEnv() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	const envPath = join(dir, '.env');
	const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
	return { dir, envPath, text, env: parseEnv(text) };
}

function runShow(argv) {
	const all = argv.includes('--all');
	const { dir, env } = readDeploymentEnv();
	const report = reportFor(env);

	console.log(pc.bold('\nThe important ones'));
	for (const row of report.rows.filter((r) => r.summary)) printRow(row);

	const rest = report.rows.filter(
		(r) => !r.summary && (all || r.source !== 'default') && r.source !== 'unset'
	);
	if (rest.length > 0) {
		console.log(pc.bold(all ? '\nEverything else' : '\nAlso set in .env'));
		for (const row of rest) printRow(row);
	}

	if (report.unknown.length > 0) {
		console.log(pc.bold('\nNot settings Selva reads'));
		for (const u of report.unknown) {
			console.log(
				`${pc.yellow('!')} ${u.key}${u.suggestion ? pc.dim(`  did you mean ${u.suggestion}?`) : ''}`
			);
		}
	}

	const drift = driftFromLastBoot(dir, env);
	if (drift && drift.length > 0) {
		console.log(pc.bold('\nDiffers from what the app last started with'));
		console.log(
			pc.dim('  Restart to apply, or check whether pm2 or the environment overrides .env.')
		);
		for (const c of drift) {
			const detail =
				c.from !== undefined || c.to !== undefined ? `  ${c.from ?? '—'} → ${c.to ?? '—'}` : '';
			console.log(`  ${c.key} ${pc.dim(c.change)}${detail}`);
		}
	}

	const errors = report.problems.filter((p) => p.status === 'error').length;
	console.log(
		'\n' +
			(errors > 0
				? pc.red(`${errors} setting${errors === 1 ? '' : 's'} would stop the app from starting.`)
				: pc.green('Nothing stops the app from starting.')) +
			(all ? '' : pc.dim('  `selva config show --all` lists every setting.'))
	);
	if (errors > 0) process.exit(1);
}

function backUp(envPath) {
	if (!existsSync(envPath)) return null;
	const bak = backupPathFor(envPath, backupStamp());
	copyFileSync(envPath, bak);
	writeEnvText(bak, readFileSync(bak, 'utf8'));
	return bak;
}

function runSet(argv) {
	const arg = argv[0] ?? '';
	const eq = arg.indexOf('=');
	if (eq <= 0) {
		console.error('Usage: selva config set KEY=VALUE');
		process.exit(1);
	}
	const key = arg.slice(0, eq);
	const value = arg.slice(eq + 1);
	const { spec, error } = checkSetting(key, value);
	if (error) {
		console.error(pc.red(`✗ ${error}`));
		process.exit(1);
	}
	const { envPath, text } = readDeploymentEnv();
	if (spec.impact) console.log(pc.yellow(`! ${spec.impact}`));
	const bak = backUp(envPath);
	writeEnvText(envPath, setEnvValues(text, { [key]: value }));
	console.log(pc.green(`✓ ${key} set.`) + (bak ? pc.dim(` Backup: ${bak}`) : ''));
	console.log(pc.dim('Restart to apply: ') + pc.cyan('selva restart'));
}

function runUnset(argv) {
	const key = argv[0];
	if (!key) {
		console.error('Usage: selva config unset KEY');
		process.exit(1);
	}
	const { envPath, text, env } = readDeploymentEnv();
	if (!(key in env)) {
		console.log(pc.dim(`${key} is not set in .env.`));
		return;
	}
	const spec = ALL_SETTINGS.find((s) => s.key === key);
	if (spec?.required) {
		console.error(pc.red(`✗ ${key} is required; the app would not start without it.`));
		process.exit(1);
	}
	if (spec?.impact) console.log(pc.yellow(`! ${spec.impact}`));
	const bak = backUp(envPath);
	writeEnvText(envPath, setEnvValues(text, { [key]: undefined }));
	console.log(pc.green(`✓ ${key} removed.`) + (bak ? pc.dim(` Backup: ${bak}`) : ''));
	console.log(pc.dim('Restart to apply: ') + pc.cyan('selva restart'));
}
