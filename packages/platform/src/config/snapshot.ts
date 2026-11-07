import { createHmac, randomBytes } from 'node:crypto';
import type { Manifest } from './manifest.js';
import type { EnvRecord } from './resolve.js';
import { rawValue } from './raw-value.js';

/**
 * The set keys of one boot, written beside `.env` so the next boot, and the
 * CLI, can say what changed. The file must not become a second copy of the
 * secrets: a generated key is stored as a salted HMAC, any other sensitive
 * value as a fixed marker, since a digest of a password or an email address
 * can be guessed back with the salt beside it.
 */
export interface ConfigSnapshot {
	version: 1;
	salt: string;
	values: Record<string, string>;
	/** Keys whose `values` entry is a digest or the marker, not the value. */
	sensitive: string[];
}

export interface ConfigChange {
	key: string;
	change: 'added' | 'removed' | 'changed';
	/** Absent for sensitive keys. */
	from?: string;
	to?: string;
}

const SENSITIVE_MARKER = 'set';

export function takeSnapshot(manifest: Manifest, env: EnvRecord, salt?: string): ConfigSnapshot {
	// A JS caller passes the previous file's salt as parsed; anything else starts afresh.
	const key = typeof salt === 'string' && salt !== '' ? salt : randomBytes(16).toString('hex');
	const values: Record<string, string> = {};
	const sensitive: string[] = [];
	for (const spec of manifest) {
		const found = rawValue(spec, env);
		if (!found) continue;
		const raw = found.raw.trim();
		if (spec.sensitive) {
			values[spec.key] = spec.generated
				? createHmac('sha256', key).update(raw).digest('hex').slice(0, 16)
				: SENSITIVE_MARKER;
			sensitive.push(spec.key);
		} else {
			values[spec.key] = raw;
		}
	}
	return { version: 1, salt: key, values, sensitive };
}

/**
 * What changed since `before`, the previous snapshot as read from disk; anything
 * that is not a snapshot counts as none. Take `after` with `before.salt`, or every
 * generated key reads as changed.
 */
export function diffSnapshots(before: unknown, after: ConfigSnapshot): ConfigChange[] {
	if (!isSnapshot(before)) return [];
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

function isSnapshot(value: unknown): value is ConfigSnapshot {
	if (typeof value !== 'object' || value === null) return false;
	const { version, salt, values, sensitive } = value as Record<string, unknown>;
	return (
		version === 1 &&
		typeof salt === 'string' &&
		salt !== '' &&
		typeof values === 'object' &&
		values !== null &&
		!Array.isArray(values) &&
		Object.values(values).every((v) => typeof v === 'string') &&
		Array.isArray(sensitive) &&
		sensitive.every((k) => typeof k === 'string')
	);
}
