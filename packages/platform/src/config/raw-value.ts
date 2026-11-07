import type { SettingSpec } from './manifest.js';
import type { EnvRecord } from './resolve.js';

/**
 * The text a setting reads and the name it came from: its own key, else the
 * first alias that is set. Blank counts as unset, so a `KEY=` line with stray
 * spaces can't hide an alias or pass a required key as an empty string.
 */
export function rawValue(
	spec: SettingSpec,
	env: EnvRecord
): { name: string; raw: string } | undefined {
	for (const name of [spec.key, ...(spec.aliases ?? [])]) {
		const raw = env[name];
		if (raw !== undefined && raw.trim() !== '') return { name, raw };
	}
	return undefined;
}
