/**
 * Queue-mode bookkeeping under churn: removals in any order keep FIFO order and the depth count
 * exact, and an input the cache can't hash rejects rather than throws.
 */
import { describe, expect, it } from 'vitest';

import { SolveScheduler } from '../solve-scheduler';
import type { SolveExecutor } from '../types';
import type { DataTree, GrasshopperComputeResponse } from '@/grasshopper/types';

const baseConfig = { serverUrl: 'http://localhost:6500' };
const response = { values: [] } as unknown as GrasshopperComputeResponse;
const tree = (i: number): DataTree[] => [{ ParamName: `p${i}`, InnerTree: {} }];

/** Runs solves one at a time; `release()` finishes the oldest one. */
function gatedExecutor() {
	const started: string[] = [];
	const gates: Array<() => void> = [];
	const executor: SolveExecutor = (_definition, dataTree) => {
		started.push(dataTree[0].ParamName);
		return new Promise((resolve) => {
			gates.push(() => resolve({ response, cacheKey: null, missed: false }));
		});
	};
	const release = async () => {
		gates.shift()?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
	};
	return { executor, started, release };
}

describe('SolveScheduler queue under churn', () => {
	it('keeps FIFO order and depth exact while queued solves are aborted', async () => {
		const { executor, started, release } = gatedExecutor();
		const s = new SolveScheduler(executor, baseConfig, { mode: 'queue' });
		const controllers = Array.from({ length: 300 }, () => new AbortController());
		const settled = controllers.map((ctl, i) =>
			s.solve('def', tree(i), { signal: ctl.signal }).then(
				() => 'ok',
				(error) => error.code
			)
		);

		// p0 runs; abort every other queued one, enough to trigger a sweep.
		for (let i = 1; i < 300; i += 2) controllers[i].abort();
		expect(s.queueDepth).toBe(149);
		expect(s.inFlightCount).toBe(1);

		for (let i = 0; i < 150; i++) await release();

		expect(started).toEqual(Array.from({ length: 150 }, (_, i) => `p${i * 2}`));
		expect(s.queueDepth).toBe(0);
		const outcomes = await Promise.all(settled);
		expect(outcomes.filter((o) => o === 'ABORTED')).toHaveLength(150);
		s.dispose();
	});

	it('still sheds at maxQueueDepth after removals free slots', async () => {
		const { executor } = gatedExecutor();
		const s = new SolveScheduler(executor, baseConfig, { mode: 'queue', maxQueueDepth: 2 });
		void s.solve('def', tree(0)).catch(() => {});
		const ctl = new AbortController();
		void s.solve('def', tree(1), { signal: ctl.signal }).catch(() => {});
		void s.solve('def', tree(2)).catch(() => {});
		await expect(s.solve('def', tree(3))).rejects.toMatchObject({ code: 'QUEUE_FULL' });

		ctl.abort();
		expect(s.queueDepth).toBe(1);
		void s.solve('def', tree(4)).catch(() => {});
		expect(s.queueDepth).toBe(2);
		s.dispose();
	});

	it('rejects an input too deep to hash with INVALID_INPUT instead of throwing', async () => {
		const { executor } = gatedExecutor();
		const s = new SolveScheduler(executor, baseConfig, { cache: { maxBytes: 1 << 20 } });
		let deep: unknown = 'x';
		for (let i = 0; i < 50_000; i++) deep = { a: deep };

		let call: Promise<unknown> | undefined;
		expect(() => {
			call = s.solve('def', [{ ParamName: 'p', InnerTree: { '{0}': [{ data: deep }] } }] as never);
		}).not.toThrow();
		await expect(call).rejects.toMatchObject({ name: 'ComputeError', code: 'INVALID_INPUT' });
		s.dispose();
	});
});
