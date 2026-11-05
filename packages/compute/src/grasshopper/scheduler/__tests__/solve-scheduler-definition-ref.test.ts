/**
 * DefinitionRef through the scheduler: everything is keyed by `ref.key` alone —
 * the result cache, the server-pointer map — and `load()` is never called by
 * the scheduler itself (only an executor may, when an upload is unavoidable).
 */
import { describe, it, expect, vi } from 'vitest';

import { SolveScheduler } from '../solve-scheduler';
import type { SolveExecutor } from '../types';
import type { DefinitionRef } from '@/core/definition-ref';
import { ErrorCodes } from '@/core/errors';
import type { GrasshopperComputeConfig, GrasshopperComputeResponse } from '@/grasshopper/types';

const baseConfig: GrasshopperComputeConfig = { serverUrl: 'http://localhost:6500' };

function makeResponse(): GrasshopperComputeResponse {
	return {
		algo: 'x',
		filename: 'f.gh',
		dataversion: 8,
		modelunits: 'Meters',
		cachesolve: false,
		values: []
	} as unknown as GrasshopperComputeResponse;
}

const makeRef = (key: string): DefinitionRef & { load: ReturnType<typeof vi.fn> } => ({
	key,
	load: vi.fn(async () => new Uint8Array([1, 2, 3]))
});

describe('scheduler + DefinitionRef', () => {
	it('serves an L1 hit for the same (ref.key, tree) across distinct ref objects, never calling load()', async () => {
		const executor = vi.fn<SolveExecutor>(async () => ({
			response: makeResponse(),
			cacheKey: null,
			missed: false
		}));
		const s = new SolveScheduler(executor, baseConfig, {
			mode: 'queue',
			cache: { maxBytes: 100_000 }
		});

		const refA = makeRef('version-1');
		const refB = makeRef('version-1'); // different object, same identity

		await s.solve(refA, []);
		await s.solve(refB, []);

		expect(executor).toHaveBeenCalledTimes(1); // second solve was a cache hit
		expect(refA.load).not.toHaveBeenCalled();
		expect(refB.load).not.toHaveBeenCalled();
	});

	it('settles as ABORTED when the signal fires while load() is pending', async () => {
		let releaseLoad!: () => void;
		const ref: DefinitionRef = {
			key: 'version-slow',
			load: () =>
				new Promise((resolve) => {
					releaseLoad = () => resolve(new Uint8Array([1]));
				})
		};
		// Mimics the real executors: materialize, then hit the transport, which
		// rejects immediately when the solve's signal is already aborted.
		const executor: SolveExecutor = async (def, _tree, _cacheKey, config) => {
			await (def as DefinitionRef).load();
			if (config.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			return { response: makeResponse(), cacheKey: null, missed: true };
		};
		const s = new SolveScheduler(executor, baseConfig, { mode: 'queue' });

		const controller = new AbortController();
		const solvePromise = s.solve(ref, [], { signal: controller.signal });
		const expectation = expect(solvePromise).rejects.toMatchObject({
			code: ErrorCodes.ABORTED
		});

		await Promise.resolve(); // let execute() start and call load()
		controller.abort();
		releaseLoad();

		await expectation;
	});
});
