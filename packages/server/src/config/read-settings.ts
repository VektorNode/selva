import type { ILogger } from '@selvajs/platform';
import { resolveConfig, type EnvRecord, type Manifest } from '@selvajs/platform/config';

/**
 * A manifest slice's values by its own rules, so a reader runs on what the config report shows.
 * Warns on a value read from an old name, and on one that failed its rule and fell back.
 */
export function readSettings(
	manifest: Manifest,
	env: EnvRecord,
	logger: ILogger
): Record<string, unknown> {
	const { values, keys } = resolveConfig(manifest, env);
	for (const key of Object.values(keys)) {
		if (key.source === 'alias') {
			logger.warn('Deprecated env var: rename it', {
				component: 'selva',
				envVar: key.alias,
				renamedTo: key.key
			});
		}
		if (key.status !== 'ok') {
			logger.warn('Invalid env value, falling back to default', {
				component: 'selva',
				envVar: key.key,
				problem: key.problem,
				fallback: key.value
			});
		}
	}
	return values;
}
