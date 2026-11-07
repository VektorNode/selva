import { createHash } from 'node:crypto';
import type { IntUnit, Manifest, SettingClass, SettingSpec } from './manifest.js';
import {
	resolveConfig,
	type EnvRecord,
	type KeyReport,
	type KeyStatus,
	type ResolveOptions,
	type UnknownKey,
	type ValueSource
} from './resolve.js';
import { rawValue } from './raw-value.js';

export interface ReportRow {
	key: string;
	label?: string;
	type: SettingSpec['type'];
	required: boolean;
	/** What 0 means for an int whose 0 is a sentinel. */
	zero?: string;
	unit?: IntUnit;
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
		return {
			key: spec.key,
			...(spec.label ? { label: spec.label } : {}),
			type: spec.type,
			required: spec.required === true,
			...(spec.type === 'int' && spec.zero ? { zero: spec.zero } : {}),
			...(spec.type === 'int' && spec.unit ? { unit: spec.unit } : {}),
			class: spec.class,
			summary: spec.summary === true,
			description: spec.description,
			...(spec.impact ? { impact: spec.impact } : {}),
			source: k.source,
			status: k.status,
			display: display(spec, k, rawValue(spec, env)?.raw),
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

/** `raw` is the env text the value came from, undefined when it is the default. */
function display(spec: SettingSpec, k: KeyReport, raw: string | undefined): string {
	if (k.source === 'unset') return '';
	if (spec.sensitive) {
		// A fingerprint of a 256-bit random key reveals nothing; of a password it
		// would be an offline guessing oracle.
		return raw !== undefined && spec.generated ? fingerprint(raw) : 'set';
	}
	return raw === undefined ? formatValue(k.value) : raw.trim();
}

function formatValue(value: unknown): string {
	if (Array.isArray(value)) return value.join(',');
	return value === undefined ? '' : String(value);
}

/** Short, stable id for a generated key, so two machines can be compared. */
export function fingerprint(value: string): string {
	return `sha256:${createHash('sha256').update(value.trim()).digest('hex').slice(0, 8)}`;
}
