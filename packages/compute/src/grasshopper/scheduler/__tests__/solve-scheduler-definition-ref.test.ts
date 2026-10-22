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

	it('keys the server-pointer map by ref.key and re-learns on a miss, without materializing', async () => {
		const calls: Array<{ cacheKey: string | null }> = [];
		let next: { cacheKey: string; missed: boolean } = { cacheKey: 'md5_FIRST', missed: false };
		const executor: SolveExecutor = async (_def, _tree, cacheKey) => {
			calls.push({ cacheKey });
			return { response: makeResponse(), ...next };
		};
		const s = new SolveScheduler(executor, baseConfig, { mode: 'queue' });

		const refA = makeRef('version-1');
		const refB = makeRef('version-1');

		// First solve: no known pointer. Distinct trees so no L1 shortcut is possible.
		await s.solve(refA, [{ ParamName: 'a', InnerTree: {} }]);
		// Second solve, same identity via a different object: learned pointer is passed.
		next = { cacheKey: 'md5_RELEARNED', missed: true }; // simulate server-side eviction
		await s.solve(refB, [{ ParamName: 'b', InnerTree: {} }]);
		// Third: the refreshed pointer from the miss is what gets used.
		await s.solve(makeRef('version-1'), [{ ParamName: 'c', InnerTree: {} }]);

		expect(calls.map((c) => c.cacheKey)).toEqual([null, 'md5_FIRST', 'md5_RELEARNED']);
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

	it('a Uint8Array caller still round-trips unchanged', async () => {
		const seen: unknown[] = [];
		const executor: SolveExecutor = async (def) => {
			seen.push(def);
			return { response: makeResponse(), cacheKey: null, missed: true };
		};
		const s = new SolveScheduler(executor, baseConfig, { mode: 'queue' });

		const bytes = new Uint8Array([9, 8, 7]);
		await s.solve(bytes, []);

		expect(seen).toEqual([bytes]); // same object, no wrapping or copying
	});
});
