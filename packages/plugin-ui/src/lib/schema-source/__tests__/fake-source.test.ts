import { describe, expect, it } from 'vitest';
import { createFakeSource } from '../fake-source';
import type { SolveReporter } from '@selvajs/ui';

// Exercises the FakeSource facets that prove the SchemaSource seam end-to-end: connect,
// event emit/subscribe, save settlement, and the vended SolveDriver. These are the contract
// the GrasshopperSource must also satisfy.

const noopReporter: SolveReporter = { report: () => {}, reportError: () => {} };

describe('FakeSource connect', () => {
	it('reports ok when connected, error when not', async () => {
		const source = createFakeSource();
		expect(await source.connect('s1')).toEqual({ ok: true });
		source.setConnected(false);
		expect(await source.connect('s1')).toEqual({ ok: false, error: 'Fake source not connected' });
	});
});

describe('FakeSource events', () => {
	it('delivers emitted events to subscribed handlers only', () => {
		const source = createFakeSource();
		const seen: unknown[] = [];
		const handler = (m: unknown) => seen.push(m);
		source.on('parametersAdded', handler);
		source.emit('parametersAdded', { sessionId: 's1', type: 'parametersAdded' });
		source.off('parametersAdded', handler);
		source.emit('parametersAdded', { sessionId: 's1', type: 'parametersAdded' });
		expect(seen).toHaveLength(1);
	});
});

describe('FakeSource save', () => {
	it('records the save and settles via the recorded resolver', async () => {
		const source = createFakeSource();
		const pending = source.save('s1', {} as never, 'base');
		expect(source.saves).toHaveLength(1);
		expect(source.saves[0].baseHash).toBe('base');
		source.saves[0].resolve({ ok: true });
		expect(await pending).toEqual({ ok: true });
	});
});

describe('FakeSource solve driver', () => {
	it('records solves, mirrors solving state, and disposes', () => {
		const source = createFakeSource();
		source.makeSolveDriver('s1', () => noopReporter);
		const driver = source.solveDriver!;

		driver.solve({ a: 1 });
		expect(driver.solves).toEqual([{ a: 1 }]);

		expect(driver.isSolving).toBe(false);
		driver.setSolving(true);
		expect(driver.isSolving).toBe(true);

		driver.cancel();
		expect(driver.cancelCount).toBe(1);

		driver.dispose();
		expect(driver.disposed).toBe(true);
	});

	it('exposes the reporter so a test can feed results back', () => {
		const source = createFakeSource();
		const reported: unknown[] = [];
		const reporter: SolveReporter = { report: (r) => reported.push(r), reportError: () => {} };
		source.makeSolveDriver('s1', () => reporter);
		source.solveDriver!.reporter.report({ outputs: { out: 1 } });
		expect(reported).toEqual([{ outputs: { out: 1 } }]);
	});
});
