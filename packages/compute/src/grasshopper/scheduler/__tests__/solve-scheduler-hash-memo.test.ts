/**
 * A multi-MB definition is hashed at most once per solve, including on the server-cache-key path:
 * a `Uint8Array` only on its first solve, a string only when it changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stable-hash', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../stable-hash')>();
	return {
		...actual,
		hashDefinition: vi.fn(actual.hashDefinition),
		hashSolveInputForDefinition: vi.fn(actual.hashSolveInputForDefinition)
	};
});

import { SolveScheduler } from '../solve-scheduler';
import type { SolveExecutor } from '../types';
import { hashDefinition, hashSolveInput, hashSolveInputForDefinition } from '../stable-hash';
import type { GrasshopperComputeConfig, GrasshopperComputeResponse } from '@/grasshopper/types';

const baseConfig: GrasshopperComputeConfig = { serverUrl: 'http://localhost:6500' };
const hashDefinitionSpy = vi.mocked(hashDefinition);
const hashTreeSpy = vi.mocked(hashSolveInputForDefinition);

function makeResponse(): GrasshopperComputeResponse {
	return { values: [] } as unknown as GrasshopperComputeResponse;
}

const plainExecutor: SolveExecutor = async () => ({
	response: makeResponse(),
	cacheKey: null,
	missed: false
});

beforeEach(() => {
	hashDefinitionSpy.mockClear();
	hashTreeSpy.mockClear();
});

describe('definition hashing in the scheduler', () => {
	it('hashes a string definition re-sent unchanged once, and a changed one again', async () => {
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' });

		await s.solve('big-base64-definition', []);
		await s.solve('big-base64-definition', []);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(1);

		await s.solve('other-base64-definition', []);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(2);
		s.dispose();
	});

	it('server-cache-key fast path: the remembered hash finds the learned pointer', async () => {
		const seenKeys: Array<string | null> = [];
		const ck: SolveExecutor = async (_def, _tree, cacheKey) => {
			seenKeys.push(cacheKey);
			return { response: makeResponse(), cacheKey: 'md5_LEARNED', missed: false };
		};
		const s = new SolveScheduler(ck, baseConfig, { mode: 'queue' });

		await s.solve('big-base64-definition', []);
		await s.solve('big-base64-definition', []);

		expect(hashDefinitionSpy).toHaveBeenCalledTimes(1);
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
			return { response: makeResponse(), cacheKey: null, missed: false };
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

	it('with the cache and hooks off, never hashes the input tree', async () => {
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' });
		await s.solve('def', [{ ParamName: 'a', InnerTree: {} }]);
		expect(hashTreeSpy).not.toHaveBeenCalled();
		s.dispose();

		const keys: string[] = [];
		const hooked = new SolveScheduler(plainExecutor, baseConfig, {
			mode: 'queue',
			onStart: (ctx) => keys.push(ctx.key)
		});
		await hooked.solve('def', [{ ParamName: 'a', InnerTree: {} }]);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toMatch(/\|t:[0-9a-f]{64}$/);
		hooked.dispose();
	});

	it('keys a hook by the tree as solved, even if the caller mutates it afterwards', async () => {
		const keys: string[] = [];
		const s = new SolveScheduler(plainExecutor, baseConfig, {
			mode: 'queue',
			onSettle: (ctx) => keys.push(ctx.key)
		});
		const tree = [{ ParamName: 'a', InnerTree: {} }];
		const solving = s.solve('def', tree);
		tree[0].ParamName = 'mutated';
		await solving;
		expect(keys).toEqual([hashSolveInput('def', [{ ParamName: 'a', InnerTree: {} }])]);
		s.dispose();
	});

	it('with reuse and the cache off, hashes nothing for a URL definition', async () => {
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' });
		await s.solve('https://example.com/def.gh', []);
		expect(hashDefinitionSpy).not.toHaveBeenCalled();
		expect(hashTreeSpy).not.toHaveBeenCalled();
		s.dispose();
	});
});
