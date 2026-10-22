/**
 * A multi-MB definition is hashed at most once per solve, including on the server-cache-key path,
 * and a `Uint8Array` only on its first solve.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stable-hash', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../stable-hash')>();
	return {
		...actual,
		hashDefinition: vi.fn(actual.hashDefinition)
	};
});

import { SolveScheduler } from '../solve-scheduler';
import type { SolveExecutor, CacheKeyExecutor } from '../types';
import { hashDefinition } from '../stable-hash';
import type { GrasshopperComputeConfig, GrasshopperComputeResponse } from '@/grasshopper/types';

const baseConfig: GrasshopperComputeConfig = { serverUrl: 'http://localhost:6500' };
const hashDefinitionSpy = vi.mocked(hashDefinition);

function makeResponse(): GrasshopperComputeResponse {
	return { values: [] } as unknown as GrasshopperComputeResponse;
}

const plainExecutor: SolveExecutor = async () => makeResponse();

beforeEach(() => {
	hashDefinitionSpy.mockClear();
});

describe('definition hashing in the scheduler', () => {
	it('plain executor path: one hashDefinition call per solve()', async () => {
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' });

		await s.solve('big-base64-definition', []);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(1);

		await s.solve('big-base64-definition', []);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(2);
		s.dispose();
	});

	it('server-cache-key fast path: still one hashDefinition call per solve()', async () => {
		const seenKeys: Array<string | null> = [];
		const ck: CacheKeyExecutor = async (_def, _tree, cacheKey) => {
			seenKeys.push(cacheKey);
			return { response: makeResponse(), cacheKey: 'md5_LEARNED', missed: false };
		};
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' }, ck);

		await s.solve('big-base64-definition', []);
		await s.solve('big-base64-definition', []);

		expect(hashDefinitionSpy).toHaveBeenCalledTimes(2);
		// The same hash keys the server-cache-key map, so the second solve reuses the pointer.
		expect(seenKeys).toEqual([null, 'md5_LEARNED']);
		s.dispose();
	});

	it('a Uint8Array is hashed on its first solve only, by identity', async () => {
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' });
		const bytes = new Uint8Array(1024).fill(7);

		await s.solve(bytes, [{ ParamName: 'a', InnerTree: {} }]);
		await s.solve(bytes, [{ ParamName: 'b', InnerTree: {} }]);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(1);

		await s.solve(new Uint8Array(1024).fill(7), []);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(2);
		s.dispose();
	});

	it('the remembered hash still keys the result cache', async () => {
		let calls = 0;
		const counting: SolveExecutor = async () => {
			calls++;
			return makeResponse();
		};
		const s = new SolveScheduler(counting, baseConfig, {
			mode: 'queue',
			cache: { maxBytes: 1024 * 1024 }
		});
		const bytes = new Uint8Array(1024).fill(7);

		await s.solve(bytes, []);
		await s.solve(bytes, []);
		await s.solve(new Uint8Array(1024).fill(7), []);
		expect(calls).toBe(1);
		s.dispose();
	});
});
