import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { UISchema } from '@selvajs/schemas';
import type { SolveDriver, SolveSession } from '@selvajs/solve/client';

import { useSolveSession } from '../useSolveSession.svelte';

const schema = {
	id: 'test',
	name: 'Test',
	inputs: [{ id: 'a', paramId: 'a', paramType: 'text', default: 'x' }],
	outputs: [],
	layout: { type: 'flat', groups: [{ items: [] }] }
} as unknown as UISchema;

function fakeDriver() {
	const stopEvents = vi.fn();
	return {
		isSolving: false as boolean,
		solve: vi.fn(),
		cancel: vi.fn(),
		reset: vi.fn(),
		onEvent: () => stopEvents,
		stopEvents
	} satisfies SolveDriver & Record<string, unknown>;
}

/** Mounts the hook the way a component would, recording what one effect reads on each run. */
function mount<T>(driver: SolveDriver, read: (session: SolveSession) => T) {
	const runs: T[] = [];
	let session!: SolveSession;
	const destroy = $effect.root(() => {
		session = useSolveSession({ schema, scopeKey: 'test', driver });
		$effect(() => {
			runs.push(read(session));
		});
	});
	flushSync();
	return { session, runs, destroy };
}

describe('useSolveSession', () => {
	it('re-runs a reader when the session notifies', () => {
		const driver = fakeDriver();
		const { session, runs, destroy } = mount(driver, (s) => s.isSolving);

		driver.isSolving = true;
		session.notify();
		flushSync();

		expect(runs).toEqual([false, true]);
		destroy();
	});

	it('shows a value change to a reader of values', () => {
		const { session, runs, destroy } = mount(fakeDriver(), (s) => s.values.a);

		session.setValue('a', 'y');
		flushSync();

		expect(runs).toEqual(['x', 'y']);
		destroy();
	});

	it('stops listening when the owner is destroyed', () => {
		const driver = fakeDriver();
		const { session, runs, destroy } = mount(driver, (s) => s.isSolving);

		destroy();
		driver.isSolving = true;
		session.notify();
		flushSync();

		expect(runs).toEqual([false]);
		// The event source outlives the component, so the session must drop it too.
		expect(driver.stopEvents).toHaveBeenCalledOnce();
		expect(driver.reset).toHaveBeenCalled();
	});
});
