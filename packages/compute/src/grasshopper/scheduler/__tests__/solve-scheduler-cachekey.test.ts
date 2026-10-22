/** Scheduler-level server-definition-cache reuse (`reuseServerDefinitionCache`). */
import { describe, it, expect } from 'vitest';

import { SolveScheduler } from '../solve-scheduler';
import type { SolveExecutor } from '../types';
import type { SolveDefinition } from '@/core/definition-ref';
import type { GrasshopperComputeConfig, GrasshopperComputeResponse } from '@/grasshopper/types';

const baseConfig: GrasshopperComputeConfig = { serverUrl: 'http://localhost:6500' };

function makeResponse(): GrasshopperComputeResponse {
	return { values: [] } as unknown as GrasshopperComputeResponse;
}

/** Records each (definition, cacheKey) it's called with, and returns a configurable key / miss. */
function recordingExecutor(
	behavior: (call: { cacheKey: string | null; n: number }) => {
		cacheKey: string | null;
		missed: boolean;
	}
) {
	const calls: Array<{ definition: SolveDefinition; cacheKey: string | null }> = [];
	const executor: SolveExecutor = async (definition, _dataTree, cacheKey) => {
		calls.push({ definition, cacheKey });
		const { cacheKey: out, missed } = behavior({ cacheKey, n: calls.length });
		return { response: makeResponse(), cacheKey: out, missed };
	};
	return { executor, calls };
}

describe('scheduler server-definition-cache reuse', () => {
	it('first solve passes null cacheKey, second reuses the learned key', async () => {
		const ex = recordingExecutor(() => ({ cacheKey: 'md5_LEARNED', missed: false }));
		const s = new SolveScheduler(ex.executor, baseConfig, { mode: 'queue' });

		await s.solve('big-definition', []);
		await s.solve('big-definition', []);

		expect(ex.calls.map((c) => c.cacheKey)).toEqual([null, 'md5_LEARNED']);
		s.dispose();
	});

	it('records a refreshed key after a miss (fallback returns a new key)', async () => {
		// Call 1 learns md5_A. Call 2 (sent md5_A) misses and the server reassigns md5_B.
		const ex = recordingExecutor(({ n }) =>
			n === 1 ? { cacheKey: 'md5_A', missed: false } : { cacheKey: 'md5_B', missed: true }
		);
		const s = new SolveScheduler(ex.executor, baseConfig, { mode: 'queue' });

		await s.solve('def', []);
		await s.solve('def', []);
		await s.solve('def', []);

		expect(ex.calls.map((c) => c.cacheKey)).toEqual([null, 'md5_A', 'md5_B']);
		s.dispose();
	});

	it('keys are per-definition (different definitions do not share a key)', async () => {
		const ex = recordingExecutor(({ cacheKey }) => ({
			cacheKey: cacheKey ?? 'md5_FOR_FIRST',
			missed: false
		}));
		const s = new SolveScheduler(ex.executor, baseConfig, { mode: 'queue' });

		await s.solve('definition-A', []);
		await s.solve('definition-B', []);

		expect(ex.calls.map((c) => c.cacheKey)).toEqual([null, null]);
		s.dispose();
	});

	it('reports definitionReuploaded from the executor while reuse is on', async () => {
		const ex = recordingExecutor(({ n }) => ({ cacheKey: 'md5_A', missed: n === 1 }));
		const s = new SolveScheduler(ex.executor, baseConfig, { mode: 'queue' });

		const first = await s.solveDetailed('def', []);
		const second = await s.solveDetailed('def', []);

		expect(first.definitionReuploaded).toBe(true);
		expect(second.definitionReuploaded).toBe(false);
		s.dispose();
	});

	it('never passes a key for URL definitions, and leaves definitionReuploaded undefined', async () => {
		const ex = recordingExecutor(() => ({ cacheKey: 'https://example.com/d.gh', missed: true }));
		const s = new SolveScheduler(ex.executor, baseConfig, { mode: 'queue' });

		await s.solve('https://example.com/d.gh', []);
		const detail = await s.solveDetailed('https://example.com/d.gh', [
			{ ParamName: 'x', InnerTree: {} }
		]);

		expect(ex.calls.map((c) => c.cacheKey)).toEqual([null, null]);
		expect(detail.definitionReuploaded).toBeUndefined();
		s.dispose();
	});

	it('respects reuseServerDefinitionCache: false (opt-out)', async () => {
		const ex = recordingExecutor(() => ({ cacheKey: 'md5_X', missed: true }));
		const s = new SolveScheduler(ex.executor, baseConfig, {
			mode: 'queue',
			reuseServerDefinitionCache: false
		});

		await s.solve('def', []);
		const detail = await s.solveDetailed('def', [{ ParamName: 'x', InnerTree: {} }]);

		expect(ex.calls.map((c) => c.cacheKey)).toEqual([null, null]);
		expect(detail.definitionReuploaded).toBeUndefined();
		s.dispose();
	});
});
