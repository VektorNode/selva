import { createHmac, randomBytes } from 'node:crypto';
import type { Manifest } from './manifest.js';
import type { EnvRecord } from './resolve.js';

/**
 * The set keys of one boot, written beside `.env` so the next boot, and the
 * CLI, can say what changed. Sensitive values are salted HMACs: the file lives
 * next to `.env`, but it must not become a second copy of the secrets.
 */
export interface ConfigSnapshot {
	version: 1;
	salt: string;
	values: Record<string, string>;
	/** Keys whose `values` entry is a digest, not the value. */
	sensitive: string[];
}

export interface ConfigChange {
	key: string;
	change: 'added' | 'removed' | 'changed';
	/** Absent for sensitive keys. */
	from?: string;
	to?: string;
}

export function takeSnapshot(
	manifest: Manifest,
	env: EnvRecord,
	salt: string = randomBytes(16).toString('hex')
): ConfigSnapshot {
	const values: Record<string, string> = {};
	const sensitive: string[] = [];
	for (const spec of manifest) {
		const name = [spec.key, ...(spec.aliases ?? [])].find(
			(k) => env[k] !== undefined && env[k] !== ''
		);
		if (name === undefined) continue;
		const raw = (env[name] as string).trim();
		if (spec.sensitive) {
			values[spec.key] = createHmac('sha256', salt).update(raw).digest('hex').slice(0, 16);
			sensitive.push(spec.key);
		} else {
			values[spec.key] = raw;
		}
	}
	return { version: 1, salt, values, sensitive };
}

/** Only meaningful when both snapshots share a salt; pass `before.salt` when taking `after`. */
export function diffSnapshots(before: ConfigSnapshot, after: ConfigSnapshot): ConfigChange[] {
	const secret = new Set([...before.sensitive, ...after.sensitive]);
	const changes: ConfigChange[] = [];
	const plain = (key: string, from?: string, to?: string) =>
		secret.has(key)
			? {}
			: { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };

	for (const [key, to] of Object.entries(after.values)) {
		const from = before.values[key];
		if (from === undefined) changes.push({ key, change: 'added', ...plain(key, undefined, to) });
		else if (from !== to) changes.push({ key, change: 'changed', ...plain(key, from, to) });
	}
	for (const [key, from] of Object.entries(before.values)) {
		if (!(key in after.values)) changes.push({ key, change: 'removed', ...plain(key, from) });
	}
	return changes;
}
