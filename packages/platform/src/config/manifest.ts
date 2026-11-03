/**
 * One declaration per environment variable: its type, default, what changing it
 * breaks, and whether a bad value stops boot. Each package declares the keys it
 * reads; a host composes the slices it ships with {@link composeManifest}.
 */

/**
 * What happens to a value that fails its rule. `fail` for anything
 * security-relevant, so a typo can't switch a control off; `default` for
 * tunables, where a typo in a cache size shouldn't take the site down on the
 * next unrelated restart.
 */
export type OnInvalid = 'fail' | 'default';

/**
 * `bootstrap`: needed before the data provider exists. `secret`: a key or
 * credential. `setting`: product behaviour an admin decides. `tunable`: a
 * limit almost nobody should touch.
 */
export type SettingClass = 'bootstrap' | 'secret' | 'setting' | 'tunable';

interface SettingBase<T> {
	key: string;
	class: SettingClass;
	onInvalid: OnInvalid;
	/** One line, shown by `selva config show` and the admin page. */
	description: string;
	/** What changing it breaks or affects. Shown before `selva config set` writes. */
	impact?: string;
	/** Absent means the key is optional with no value. */
	default?: T;
	required?: boolean;
	/** Never shown in clear: secrets and personal data. */
	sensitive?: boolean;
	/** 256-bit random key: safe to fingerprint, unlike a low-entropy secret. */
	generated?: boolean;
	/** Shown at the top of the admin Configuration section. */
	summary?: boolean;
	/** Previous names. Read when the key is unset; `selva migrate` renames them. */
	aliases?: readonly string[];
	/**
	 * How the reader parsed this key before it parsed strictly. `selva migrate`
	 * rewrites a value to what it meant then, so a stricter parser can't change
	 * a deployment's behaviour behind its back. Data, not a function: the CLI
	 * reads the manifest as JSON.
	 */
	legacy?: LegacyParse;
}

/**
 * `exact-true`: only the string `true` was on. `not-false`: anything but the
 * string `false` was on. `enumFallback`: an unrecognised value meant this one.
 */
export type LegacyParse = { bool: 'exact-true' | 'not-false' } | { enumFallback: string };

export interface StringSetting extends SettingBase<string> {
	type: 'string';
	minLength?: number;
}
/** 32 bytes, as 64 hex characters or base64: what `decodeSecretKey` accepts. */
export interface KeySetting extends SettingBase<string> {
	type: 'key';
}
export interface UrlSetting extends SettingBase<string> {
	type: 'url';
}
export interface IntSetting extends SettingBase<number> {
	type: 'int';
	min?: number;
	max?: number;
}
export interface BoolSetting extends SettingBase<boolean> {
	type: 'bool';
}
export interface EnumSetting extends SettingBase<string> {
	type: 'enum';
	values: readonly string[];
}
export interface ListSetting extends SettingBase<readonly string[]> {
	type: 'list';
}

export type SettingSpec =
	StringSetting | KeySetting | UrlSetting | IntSetting | BoolSetting | EnumSetting | ListSetting;

export type Manifest = readonly SettingSpec[];

export function defineSetting<S extends SettingSpec>(spec: S): S {
	return spec;
}

/** Flattens slices and rejects a key declared twice: two readers, two defaults. */
export function composeManifest(parts: ReadonlyArray<SettingSpec | Manifest>): Manifest {
	const out: SettingSpec[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		for (const spec of Array.isArray(part) ? part : [part as SettingSpec]) {
			for (const name of [spec.key, ...(spec.aliases ?? [])]) {
				if (seen.has(name)) throw new Error(`Config key ${name} is declared twice`);
				seen.add(name);
			}
			out.push(spec);
		}
	}
	return out;
}
