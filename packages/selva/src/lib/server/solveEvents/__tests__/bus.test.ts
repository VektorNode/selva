import { describe, it, expect } from 'vitest';
import { createSolveEventBus } from '../bus.server';
import type { SolveEvent } from '@selvajs/schemas';

function collect() {
	const events: SolveEvent[] = [];
	return { events, write: (e: SolveEvent) => events.push(e) };
}

describe('SolveEventBus', () => {
	it("routes a solve's events to its stream and re-stamps seq per solve", () => {
		const bus = createSolveEventBus();
		const sink = collect();
		bus.openStream('s1', 'user:a', sink.write);
		bus.openSolve('solve-1', 's1', 'user:a');

		bus.publish('solve-1', [{ type: 'solveStarted', at: 't' }]);
		bus.publish('solve-1', [
			{ type: 'diagnostic', at: 't', payload: { level: 'warning' } },
			{ type: 'progress', at: 't' }
		]);

		expect(sink.events.map((e) => [e.solveId, e.seq, e.type])).toEqual([
			['solve-1', 1, 'solveStarted'],
			['solve-1', 2, 'diagnostic'],
			['solve-1', 3, 'progress']
		]);
	});

	it('drops events for a solve it does not know', () => {
		const bus = createSolveEventBus();
		const sink = collect();
		bus.openStream('s1', 'user:a', sink.write);
		expect(bus.publish('nope', [{ type: 'diagnostic', at: 't' }])).toEqual({ abort: false });
		expect(sink.events).toEqual([]);
	});

	it('only the owner may abort, and the flag rides the next publish reply', () => {
		const bus = createSolveEventBus();
		bus.openStream('s1', 'user:a', () => {});
		bus.openSolve('solve-1', 's1', 'user:a');

		expect(bus.requestAbort('solve-1', 'user:b')).toBe(false);
		expect(bus.publish('solve-1', [])).toEqual({ abort: false });

		expect(bus.requestAbort('solve-1', 'user:a')).toBe(true);
		expect(bus.publish('solve-1', [])).toEqual({ abort: true });
	});

	it('closing a solve stops delivery and unsubscribing a stream drops its writer', () => {
		const bus = createSolveEventBus();
		const sink = collect();
		const unsubscribe = bus.openStream('s1', 'user:a', sink.write);
		bus.openSolve('solve-1', 's1', 'user:a');

		bus.closeSolve('solve-1');
		expect(bus.isOpen('solve-1')).toBe(false);
		bus.publish('solve-1', [{ type: 'diagnostic', at: 't' }]);
		expect(sink.events).toEqual([]);

		unsubscribe();
		expect(bus.ownsStream('s1', 'user:a')).toBe(false);
	});

	it('caps chatter per second but never drops a diagnostic', () => {
		const bus = createSolveEventBus();
		const sink = collect();
		bus.openStream('s1', 'user:a', sink.write);
		bus.openSolve('solve-1', 's1', 'user:a');

		const flood = Array.from({ length: 250 }, () => ({ type: 'progress', at: 't' }));
		bus.publish('solve-1', flood);
		bus.publish('solve-1', [{ type: 'diagnostic', at: 't' }]);

		expect(sink.events.filter((e) => e.type === 'progress')).toHaveLength(200);
		expect(sink.events.filter((e) => e.type === 'diagnostic')).toHaveLength(1);
	});
});
