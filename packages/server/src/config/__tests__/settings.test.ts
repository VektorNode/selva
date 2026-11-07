import { describe, expect, it } from 'vitest';
import { resolveConfig, type EnvRecord } from '@selvajs/platform/config';
import { ENGINE_SETTINGS } from '../index.js';
import { resolveComputeLimits } from '../../compute/limits.js';
import { resolveApiRateLimitConfig } from '../../api/rate-limit.js';
import { resolveSignInMaxAgeMs } from '../../http/sign-in-age.js';

// `selva config show` and the admin page report what ENGINE_SETTINGS resolves.
// A reader that parsed env on its own would run on another value, most often
// when the value is invalid and the report shows the default.
describe('the readers run on the value ENGINE_SETTINGS reports', () => {
	const MB = 1024 * 1024;
	const reported = (env: EnvRecord) => resolveConfig(ENGINE_SETTINGS, env).values;

	it.each<[string, EnvRecord]>([
		['unset', {}],
		[
			'set',
			{
				COMPUTE_RATE_LIMIT_MAX: '30',
				COMPUTE_DEFINITION_CACHE_MB: '0',
				API_TOKEN_RATE_LIMIT_MAX: '0'
			}
		],
		[
			'invalid',
			{
				COMPUTE_RATE_LIMIT_MAX: '0.5',
				MAX_DEFINITION_FILE_SIZE_BYTES: '-1',
				COMPUTE_SOLVE_CACHE_MB: 'lots',
				COMPUTE_SERVER_CACHESOLVE: 'maybe',
				API_TOKEN_RATE_LIMIT_MAX: '0.5'
			}
		],
		['under an old name', { COMPUTE_RESPONSE_CACHE_MB: '8' }]
	])('%s', (_label, env) => {
		const values = reported(env);
		const limits = resolveComputeLimits(env);
		expect(limits.rateLimitMaxRequests).toBe(values.COMPUTE_RATE_LIMIT_MAX);
		expect(limits.maxDefinitionFileSize).toBe(values.MAX_DEFINITION_FILE_SIZE_BYTES);
		expect(limits.computeMaxQueueDepth).toBe(values.COMPUTE_MAX_QUEUE_DEPTH);
		expect(limits.computeQueueWaitMs).toBe(values.COMPUTE_QUEUE_WAIT_MS);
		expect(limits.computeDefinitionCacheBytes).toBe(
			(values.COMPUTE_DEFINITION_CACHE_MB as number) * MB
		);
		expect(limits.computeSolveCacheBytes).toBe((values.COMPUTE_SOLVE_CACHE_MB as number) * MB);
		expect(limits.computeServerCachesolve).toBe(values.COMPUTE_SERVER_CACHESOLVE);
		expect(resolveApiRateLimitConfig(env).maxPerWindow).toBe(values.API_TOKEN_RATE_LIMIT_MAX);
	});

	it('sign-in max age: a value the report refuses stops the reader too', () => {
		const ok = { SIGN_IN_MAX_AGE_DAYS: '7' };
		expect(resolveSignInMaxAgeMs(ok)).toBe(
			(reported(ok).SIGN_IN_MAX_AGE_DAYS as number) * 86_400_000
		);

		const bad = { SIGN_IN_MAX_AGE_DAYS: '0.5' };
		expect(resolveConfig(ENGINE_SETTINGS, bad).keys.SIGN_IN_MAX_AGE_DAYS.status).toBe('error');
		expect(() => resolveSignInMaxAgeMs(bad)).toThrow(/SIGN_IN_MAX_AGE_DAYS/);
	});
});
