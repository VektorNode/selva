import { createHash } from 'node:crypto';
import type { Manifest, SettingClass } from './manifest.js';
import {
	resolveConfig,
	type EnvRecord,
	type KeyStatus,
	type ResolveOptions,
	type UnknownKey,
	type ValueSource
} from './resolve.js';

export interface ReportRow {
	key: string;
	class: SettingClass;
	summary: boolean;
	description: string;
	impact?: string;
	source: ValueSource;
	status: KeyStatus;
	/** Safe to print: secrets are a fingerprint or "set", never the value. */
	display: string;
	problem?: string;
	alias?: string;
}

export interface ConfigReport {
	/** Summary rows first, then the rest, each in manifest order. */
	rows: ReportRow[];
	/** Rows whose value failed its rule. */
	problems: ReportRow[];
	unknown: UnknownKey[];
}

/**
 * What `selva config show` and the admin page render. Pure, and free of
 * secret values, so the result can go to a browser or a terminal as is.
 */
export function buildConfigReport(
	manifest: Manifest,
	env: EnvRecord,
	options: ResolveOptions = {}
): ConfigReport {
	const resolved = resolveConfig(manifest, env, options);
	const rows: ReportRow[] = manifest.map((spec) => {
		const k = resolved.keys[spec.key];
		const raw = k.source === 'alias' ? env[k.alias!] : env[spec.key];
		return {
			key: spec.key,
			class: spec.class,
			summary: spec.summary === true,
			description: spec.description,
			...(spec.impact ? { impact: spec.impact } : {}),
			source: k.source,
			status: k.status,
			display: display(spec.sensitive === true, spec.generated === true, k.source, raw, k.value),
			...(k.problem ? { problem: k.problem } : {}),
			...(k.alias ? { alias: k.alias } : {})
		};
	});
	return {
		rows: [...rows.filter((r) => r.summary), ...rows.filter((r) => !r.summary)],
		problems: rows.filter((r) => r.status !== 'ok'),
		unknown: resolved.unknown
	};
}

function display(
	sensitive: boolean,
	generated: boolean,
	source: ValueSource,
	raw: string | undefined,
	value: unknown
): string {
	if (source === 'unset') return '';
	if (sensitive && raw !== undefined) {
		// A fingerprint of a 256-bit random key reveals nothing; of a password it
		// would be an offline guessing oracle.
		return generated ? fingerprint(raw) : 'set';
	}
	if (sensitive) return 'set';
	if (source === 'default' || raw === undefined) return formatValue(value);
	return raw.trim();
}

function formatValue(value: unknown): string {
	if (Array.isArray(value)) return value.join(',');
	return value === undefined ? '' : String(value);
}

/** Short, stable id for a generated key, so two machines can be compared. */
export function fingerprint(value: string): string {
	return `sha256:${createHash('sha256').update(value.trim()).digest('hex').slice(0, 8)}`;
}
