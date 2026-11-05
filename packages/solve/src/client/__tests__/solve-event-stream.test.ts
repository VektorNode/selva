import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSolveEventStream, type SolveEventStream } from '../events/solve-event-stream.js';

/** Stands in for the browser's `EventSource`, driven by the test. */
class FakeEventSource {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 2;
	static instances: FakeEventSource[] = [];

	readyState = FakeEventSource.CONNECTING;
	closed = false;
	private listeners = new Map<string, ((event: unknown) => void)[]>();

	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: (event: unknown) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	close() {
		this.closed = true;
		this.readyState = FakeEventSource.CLOSED;
	}

	private dispatch(type: string, event?: unknown) {
		this.listeners.get(type)?.forEach((listener) => listener(event));
	}

	open() {
		this.readyState = FakeEventSource.OPEN;
		this.dispatch('open');
	}

	send(data: unknown) {
		const payload = typeof data === 'string' ? data : JSON.stringify(data);
		this.dispatch('solve', { data: payload });
	}

	/** A dropped connection: the browser retries by itself. */
	drop() {
		this.readyState = FakeEventSource.CONNECTING;
		this.dispatch('error');
	}

	/** A non-200: the browser gives up on this object for good. */
	fail() {
		this.readyState = FakeEventSource.CLOSED;
		this.dispatch('error');
	}
}

const sources = () => FakeEventSource.instances;
const last = () => sources()[sources().length - 1];

function stream(over: Partial<Parameters<typeof createSolveEventStream>[0]> = {}) {
	return createSolveEventStream({
		endpoint: '/events',
		cancelEndpoint: (id) => `/cancel/${id}`,
		...over
	});
}

function started(s: SolveEventStream, solveId = 'A') {
	last().send({ type: 'solveStarted', solveId, seq: 1 });
	return s;
}

beforeEach(() => {
	FakeEventSource.instances = [];
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('createSolveEventStream', () => {
	it('connects on creation, before anyone subscribes', () => {
		const s = stream();
		expect(sources()).toHaveLength(1);
		expect(last().url).toBe(`/events?streamId=${s.streamId}`);
	});

	it('appends the stream id with & when the endpoint already has a query', () => {
		const s = stream({ endpoint: '/events?x=1' });
		expect(last().url).toBe(`/events?x=1&streamId=${s.streamId}`);
	});

	it('does nothing without EventSource, as on a server render', () => {
		vi.stubGlobal('EventSource', undefined);
		expect(stream().currentSolveId).toBeNull();
	});

	it('forwards events to subscribers until they unsubscribe', () => {
		const s = stream();
		const listener = vi.fn();
		const off = s.subscribe(listener);
		last().send({ type: 'progress', solveId: 'A', seq: 1 });
		off();
		last().send({ type: 'progress', solveId: 'A', seq: 2 });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('skips a malformed frame and keeps going', () => {
		const s = stream();
		const listener = vi.fn();
		s.subscribe(listener);
		last().send('{not json');
		last().send({ type: 'progress', solveId: 'A', seq: 1 });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('tracks the current solve from its start to its end', () => {
		const s = stream();
		started(s, 'A');
		expect(s.currentSolveId).toBe('A');
		last().send({ type: 'solveEnded', solveId: 'other', seq: 2 });
		expect(s.currentSolveId).toBe('A');
		last().send({ type: 'solveEnded', solveId: 'A', seq: 3 });
		expect(s.currentSolveId).toBeNull();
	});

	it('cancelCurrent posts for the running solve', async () => {
		const fetch = vi.fn(async () => new Response());
		const s = stream({ fetch });
		started(s, 'A');
		s.cancelCurrent?.();
		expect(fetch).toHaveBeenCalledWith('/cancel/A', { method: 'POST', keepalive: true });
	});

	it('cancelCurrent does nothing between solves, and swallows a failed post', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('net');
		});
		const s = stream({ fetch });
		s.cancelCurrent?.();
		expect(fetch).not.toHaveBeenCalled();
		started(s, 'A');
		s.cancelCurrent?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('after a non-200', () => {
	it('reopens under the same stream id, because the browser will not', async () => {
		const s = stream();
		last().fail();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(sources()).toHaveLength(2);
		expect(last().url).toContain(s.streamId);
	});

	it('forgets the solve it can no longer hear the end of', () => {
		const s = stream();
		started(s, 'A');
		last().fail();
		expect(s.currentSolveId).toBeNull();
	});

	it('keeps its subscribers across the reconnect', async () => {
		const s = stream();
		const listener = vi.fn();
		s.subscribe(listener);
		last().fail();
		await vi.advanceTimersByTimeAsync(1_000);
		last().send({ type: 'progress', solveId: 'A', seq: 1 });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('backs off while the server keeps refusing, up to a ceiling', async () => {
		stream();
		const delays: number[] = [];
		for (let attempt = 0; attempt < 7; attempt++) {
			const before = sources().length;
			last().fail();
			let waited = 0;
			while (sources().length === before) {
				await vi.advanceTimersByTimeAsync(1_000);
				waited += 1_000;
			}
			delays.push(waited);
		}
		expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
	});

	it('starts the backoff over once a connection opens', async () => {
		stream();
		last().fail();
		await vi.advanceTimersByTimeAsync(1_000);
		last().fail();
		await vi.advanceTimersByTimeAsync(2_000);
		last().open();
		last().fail();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(sources()).toHaveLength(4);
	});
});

describe('a dropped connection', () => {
	it('stays with the browser, which retries by itself', async () => {
		stream();
		last().drop();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sources()).toHaveLength(1);
	});
});

describe('close', () => {
	it('closes the connection and forgets the current solve', () => {
		const s = stream();
		started(s, 'A');
		const source = last();
		s.close();
		expect(source.closed).toBe(true);
		expect(s.currentSolveId).toBeNull();
	});

	it('is final: a pending reconnect is dropped and a new subscriber opens nothing', async () => {
		const s = stream();
		last().fail();
		s.close();
		s.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sources()).toHaveLength(1);
	});
});
