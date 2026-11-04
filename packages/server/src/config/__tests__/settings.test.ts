import { describe, expect, it } from 'vitest';
import { resolveConfig } from '@selvajs/platform/config';
import { ENGINE_SETTINGS } from '../index.js';
import { resolveComputeLimits } from '../../compute/limits.js';
import { DEFAULT_API_RATE_LIMIT, resolveApiRateLimitConfig } from '../../api/rate-limit.js';

// The readers still parse env themselves; the manifest is what `selva config
// show` and the admin page report. A default that differs between the two
// would show operators one value while the app runs on another.
describe('ENGINE_SETTINGS matches the readers it documents', () => {
	const defaults = resolveConfig(ENGINE_SETTINGS, {}).values;
	const MB = 1024 * 1024;

	it('compute limits', () => {
		const limits = resolveComputeLimits({});
		expect(defaults.COMPUTE_RATE_LIMIT_MAX).toBe(limits.rateLimitMaxRequests);
		expect(defaults.MAX_DEFINITION_FILE_SIZE_BYTES).toBe(limits.maxDefinitionFileSize);
		expect(defaults.COMPUTE_MAX_QUEUE_DEPTH).toBe(limits.computeMaxQueueDepth);
		expect(defaults.COMPUTE_QUEUE_WAIT_MS).toBe(limits.computeQueueWaitMs);
		expect((defaults.COMPUTE_DEFINITION_CACHE_MB as number) * MB).toBe(
			limits.computeDefinitionCacheBytes
		);
		expect((defaults.COMPUTE_SOLVE_CACHE_MB as number) * MB).toBe(limits.computeSolveCacheBytes);
		expect(defaults.COMPUTE_SERVER_CACHESOLVE).toBe(limits.computeServerCachesolve);
	});

	it('API token rate limit', () => {
		expect(resolveApiRateLimitConfig({})).toEqual(DEFAULT_API_RATE_LIMIT);
		expect(defaults.API_TOKEN_RATE_LIMIT_MAX).toBe(DEFAULT_API_RATE_LIMIT.maxPerWindow);
	});

	it('old names map to the same keys the readers accept', () => {
		const old = { COMPUTE_RESPONSE_CACHE_MB: '8' };
		const resolved = resolveConfig(ENGINE_SETTINGS, old).values;
		const limits = resolveComputeLimits(old);
		expect((resolved.COMPUTE_SOLVE_CACHE_MB as number) * MB).toBe(limits.computeSolveCacheBytes);
	});
});
