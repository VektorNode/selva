import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import {
	diffSnapshots,
	type ConfigChange,
	type ConfigReport,
	type ConfigSnapshot,
	type KeyRotation
} from '@selvajs/platform/config';
import { getLogger } from '$lib/server/providers.server';
import { findDeploymentDir } from '$lib/server/selfUpdate.server';
import { deploymentReport, deploymentSnapshot, keyRotationStatus } from './settings.js';
import { configChecks, type CheckInput, type ConfigCheck } from './checks.js';

/** Beside `.env` in the deployment directory. The CLI reads it too. */
export const SNAPSHOT_FILE = '.selva-config-snapshot.json';

let report: ConfigReport | null = null;
let changes: ConfigChange[] = [];

/** The configuration this process runs on, safe to send to an admin's browser. */
export function getConfigReport(): ConfigReport {
	report ??= deploymentReport(env);
	return report;
}

/** Each root key's rotation overlap, read now so a deadline that passes shows without a restart. */
export function getKeyRotation(): KeyRotation[] {
	return keyRotationStatus(env);
}

/** Findings for the admin page, read per request: proxy detection depends on the request. */
export function getConfigChecks(
	input: Omit<CheckInput, 'env' | 'report' | 'rotation'>
): ConfigCheck[] {
	return configChecks({ ...input, env, report: getConfigReport(), rotation: getKeyRotation() });
}

/** What differs from the previous boot's snapshot. Empty outside a deployment. */
export function getChangesSinceLastBoot(): ConfigChange[] {
	return changes;
}

/**
 * Run once at server start. Throws on a fail-closed key with a bad value, so a
 * typo in a security control stops boot instead of switching the control off.
 */
export function checkConfigAtBoot(): void {
	const current = getConfigReport();
	const log = getLogger();

	const errors = current.problems.filter((p) => p.status === 'error');
	for (const p of current.problems.filter((r) => r.status === 'invalid')) {
		log.warn('Invalid env value, using the default', {
			component: 'config',
			envVar: p.key,
			problem: p.problem
		});
	}
	for (const u of current.unknown) {
		log.warn('Unknown env var', { component: 'config', envVar: u.key, suggestion: u.suggestion });
	}
	for (const row of current.rows.filter((r) => r.source === 'alias')) {
		log.warn('Deprecated env var: run `selva migrate`', {
			component: 'config',
			envVar: row.alias,
			renamedTo: row.key
		});
	}
	for (const r of getKeyRotation()) {
		if (r.state === 'expired' || r.state === 'no-deadline') {
			log.warn(
				r.state === 'expired'
					? 'Previous key passed its deadline and is no longer accepted: remove it'
					: 'Previous key has no deadline and is accepted for good',
				{ component: 'config', envVar: `${r.key}_PREVIOUS`, expires: r.expires }
			);
		}
	}
	if (errors.length > 0) {
		throw new Error(
			'Invalid configuration:\n' + errors.map((e) => `  ${e.key} ${e.problem}`).join('\n')
		);
	}

	changes = recordSnapshot();
	if (changes.length > 0) {
		log.info('Configuration changed since the last boot', {
			component: 'config',
			keys: changes.map((c) => c.key)
		});
	}
}

function recordSnapshot(): ConfigChange[] {
	const dir = findDeploymentDir(env);
	if (!dir) return [];
	const path = join(dir, SNAPSHOT_FILE);
	let previous: ConfigSnapshot | null = null;
	try {
		if (existsSync(path)) previous = JSON.parse(readFileSync(path, 'utf8')) as ConfigSnapshot;
	} catch {
		previous = null;
	}
	const next = deploymentSnapshot(env, previous?.salt);
	try {
		writeFileSync(path, JSON.stringify(next, null, '\t') + '\n', { mode: 0o600 });
		if (process.platform !== 'win32') chmodSync(path, 0o600);
	} catch (err) {
		getLogger().warn('Could not write the config snapshot', {
			component: 'config',
			err: err instanceof Error ? err.message : String(err)
		});
	}
	return previous ? diffSnapshots(previous, next) : [];
}
