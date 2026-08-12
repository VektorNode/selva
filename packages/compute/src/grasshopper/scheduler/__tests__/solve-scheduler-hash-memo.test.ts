/**
 * Issue 57 (remaining part): a string/binary definition used to be linearly
 * FNV-hashed twice per solve — once by `hashSolveInput` at `solve()` entry and
 * again by `hashDefinition` inside `runExecutor` (server-cache-key map). The
 * hash computed at entry is now threaded through to the executor path, so each
 * solve pays exactly one pass over the (potentially multi-MB) definition.
 *
 * Pins: `hashDefinition` is invoked exactly once per solve() call — including
 * when the server-cache-key fast path runs — and cache-key semantics are
 * unchanged (same definition still maps to the same server key entry).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stable-hash', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../stable-hash')>();
	return {
		...actual,
		hashDefinition: vi.fn(actual.hashDefinition)
	};
});

import { SolveScheduler, type SolveExecutor, type CacheKeyExecutor } from '../solve-scheduler';
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

describe('definition hash is computed once per solve (issue 57)', () => {
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

		// Previously 2 calls per solve (entry + runExecutor) = 4 total.
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(2);
		// Semantics unchanged: the threaded hash still keys the server-cache-key
		// map, so the second solve reuses the learned pointer.
		expect(seenKeys).toEqual([null, 'md5_LEARNED']);
		s.dispose();
	});

	it('binary definitions are also hashed once per solve()', async () => {
		const s = new SolveScheduler(plainExecutor, baseConfig, { mode: 'queue' });
		await s.solve(new Uint8Array(1024).fill(7), []);
		expect(hashDefinitionSpy).toHaveBeenCalledTimes(1);
		s.dispose();
	});
});
