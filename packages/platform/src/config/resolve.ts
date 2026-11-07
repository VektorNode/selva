import type { Manifest, SettingSpec } from './manifest.js';
import { trimTrailing } from '../utils/trim.js';
import { parseKey32 } from '../computeServer/key32.js';
import { rawValue } from './raw-value.js';

export type EnvRecord = Record<string, string | undefined>;

/** `alias` means the value arrived under a previous name. */
export type ValueSource = 'env' | 'alias' | 'default' | 'unset';

/** `invalid`: set, failed its rule, fell back. `error`: failed a fail-closed rule. */
export type KeyStatus = 'ok' | 'invalid' | 'error';

export interface KeyReport {
	key: string;
	spec: SettingSpec;
	source: ValueSource;
	status: KeyStatus;
	value: unknown;
	/** The previous name the value was read from, when `source` is `alias`. */
	alias?: string;
	/** Why the value was rejected. Never echoes the value: it may be a secret. */
	problem?: string;
}

export interface UnknownKey {
	key: string;
	/** Nearest declared name, when one is close enough to be a typo. */
	suggestion?: string;
}

export interface ResolvedConfig {
	values: Record<string, unknown>;
	keys: Record<string, KeyReport>;
	/** Keys that failed a fail-closed rule. A host refuses to boot on any. */
	errors: KeyReport[];
	unknown: UnknownKey[];
}

export interface ResolveOptions {
	/** Env keys under these prefixes that no setting declares are reported as unknown. */
	prefixes?: readonly string[];
	/** Keys a host knows about but doesn't resolve here (another tool reads them). */
	external?: readonly string[];
}

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

type Parsed = { ok: true; value: unknown } | { ok: false; problem: string };

function parse(spec: SettingSpec, raw: string): Parsed {
	const v = raw.trim();
	switch (spec.type) {
		case 'string':
			if (spec.minLength !== undefined && v.length < spec.minLength) {
				return { ok: false, problem: `must be at least ${spec.minLength} characters` };
			}
			return { ok: true, value: v };
		case 'key':
			return parseKey32(v)
				? { ok: true, value: v }
				: { ok: false, problem: 'must be 32 bytes as 64 hex characters or base64' };
		case 'url': {
			const value = trimTrailing(v, '/');
			let url: URL;
			try {
				url = new URL(value);
			} catch {
				return { ok: false, problem: 'must be an absolute URL' };
			}
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return { ok: false, problem: 'must start with http:// or https://' };
			}
			if (spec.origin && (url.username || url.password || url.pathname !== '/' || /[?#]/.test(v))) {
				return {
					ok: false,
					problem:
						'must be an origin such as https://selva.example.com: no path, query or credentials'
				};
			}
			return { ok: true, value };
		}
		case 'int': {
			// Not `Number(v)` alone: it reads `0x10`, `1e3` and blank as numbers.
			if (!/^[+-]?\d+$/.test(v)) return { ok: false, problem: 'must be a whole number' };
			const n = Number(v);
			if (!Number.isSafeInteger(n)) return { ok: false, problem: 'is too large' };
			if (spec.min !== undefined && n < spec.min)
				return { ok: false, problem: `must be ≥ ${spec.min}` };
			if (spec.max !== undefined && n > spec.max)
				return { ok: false, problem: `must be ≤ ${spec.max}` };
			// `-0` is a different value to `Object.is` and to `1 / n`.
			return { ok: true, value: n === 0 ? 0 : n };
		}
		case 'bool': {
			const lower = v.toLowerCase();
			if (TRUE.has(lower)) return { ok: true, value: true };
			if (FALSE.has(lower)) return { ok: true, value: false };
			return { ok: false, problem: 'must be true or false' };
		}
		case 'enum': {
			const lower = v.toLowerCase();
			const match = spec.values.find((m) => m.toLowerCase() === lower);
			return match !== undefined
				? { ok: true, value: match }
				: { ok: false, problem: `must be one of ${spec.values.join(' | ')}` };
		}
		case 'list':
			return {
				ok: true,
				value: v
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			};
	}
}

/** What `raw` meant to the reader before it parsed strictly. */
export function legacyValue(spec: SettingSpec, raw: string): unknown {
	const legacy = spec.legacy;
	if (legacy && 'bool' in legacy) {
		return legacy.bool === 'exact-true' ? raw === 'true' : raw !== 'false';
	}
	if (legacy && 'enumFallback' in legacy && spec.type === 'enum') {
		return spec.values.includes(raw) ? raw : legacy.enumFallback;
	}
	const parsed = parse(spec, raw);
	return parsed.ok ? parsed.value : undefined;
}

function resolveKey(spec: SettingSpec, env: EnvRecord): KeyReport {
	const found = rawValue(spec, env);
	if (!found) {
		const source: ValueSource = spec.default !== undefined ? 'default' : 'unset';
		const base = { key: spec.key, spec, source };
		if (spec.required) {
			return { ...base, status: 'error', value: undefined, problem: 'is required' };
		}
		return { ...base, status: 'ok', value: spec.default };
	}

	const alias = found.name === spec.key ? undefined : found.name;
	const source: ValueSource = alias ? 'alias' : 'env';
	const base = { key: spec.key, spec, source, ...(alias ? { alias } : {}) };
	const parsed = parse(spec, found.raw);
	if (parsed.ok) return { ...base, status: 'ok', value: parsed.value };
	if (spec.onInvalid === 'fail') {
		return { ...base, status: 'error', value: undefined, problem: parsed.problem };
	}
	return { ...base, status: 'invalid', value: spec.default, problem: parsed.problem };
}

/** One setting's value by the manifest's rules: its default when unset or invalid. */
export function readSetting(spec: SettingSpec, env: EnvRecord): unknown {
	return resolveKey(spec, env).value;
}

/** Resolve every declared key from an env map. Pure: reads nothing ambient. */
export function resolveConfig(
	manifest: Manifest,
	env: EnvRecord,
	options: ResolveOptions = {}
): ResolvedConfig {
	const values: Record<string, unknown> = {};
	const keys: Record<string, KeyReport> = {};
	const errors: KeyReport[] = [];
	const known = new Set<string>(options.external ?? []);

	for (const spec of manifest) {
		known.add(spec.key);
		for (const a of spec.aliases ?? []) known.add(a);
		const report = resolveKey(spec, env);
		keys[spec.key] = report;
		values[spec.key] = report.value;
		if (report.status === 'error') errors.push(report);
	}

	const declared = manifest.map((s) => s.key);
	const prefixes = options.prefixes ?? [];
	const unknown: UnknownKey[] = [];
	for (const key of Object.keys(env)) {
		if (known.has(key) || !prefixes.some((p) => key.startsWith(p))) continue;
		const suggestion = nearest(key, declared);
		unknown.push(suggestion ? { key, suggestion } : { key });
	}

	return { values, keys, errors, unknown };
}

/** A declared name within a typo's reach: a prefix of it, or a few edits away. */
function nearest(key: string, declared: readonly string[]): string | undefined {
	let best: string | undefined;
	let bestDistance = Infinity;
	for (const candidate of declared) {
		const d =
			candidate.startsWith(key) || key.startsWith(candidate) ? 0 : editDistance(key, candidate);
		if (d < bestDistance) {
			best = candidate;
			bestDistance = d;
		}
	}
	return bestDistance <= 3 ? best : undefined;
}

function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[b.length];
}
