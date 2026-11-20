import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncSolveStore, acceptedResponse, wantsAsync } from '../server/async-solves.js';
import { followAsyncSolve } from '../client/async-solve.js';

const stores: AsyncSolveStore[] = [];
function makeStore(options: ConstructorParameters<typeof AsyncSolveStore>[0] = {}) {
	const store = new AsyncSolveStore({ sweepIntervalMs: 60_000, ...options });
	stores.push(store);
	return store;
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

describe('AsyncSolveStore', () => {
	it('answers running, then the stored response with its status and headers', async () => {
		const store = makeStore();
		const work = deferred<Response>();
		const id = store.start('user:a', () => work.promise);

		expect(await store.read(id, 'user:a', 0)).toEqual({ kind: 'running' });
		work.resolve(new Response('{"ok":1}', { status: 200, headers: { 'x-a': '1' } }));

		const read = await store.read(id, 'user:a', 1_000);
		expect(read.kind).toBe('done');
		if (read.kind !== 'done') return;
		expect(read.status).toBe(200);
		expect(read.headers).toContainEqual(['x-a', '1']);
		expect(new TextDecoder().decode(read.body!)).toBe('{"ok":1}');
	});

	it('hides a user-owned solve from anyone else, but lets anyone read an ownerless one', async () => {
		const store = makeStore();
		const owned = store.start('user:a', async () => new Response('x'));
		const open = store.start(null, async () => new Response('y'));
		expect(await store.read(owned, 'user:b', 0)).toEqual({ kind: 'unknown' });
		expect(await store.read(owned, null, 0)).toEqual({ kind: 'unknown' });
		expect((await store.read(open, 'user:b', 100)).kind).toBe('done');
	});

	it('turns a thrown error into a 500 response', async () => {
		const store = makeStore();
		const id = store.start(null, async () => {
			throw new Error('boom');
		});
		const read = await store.read(id, null, 1_000);
		expect(read.kind === 'done' && read.status).toBe(500);
	});

	it('aborts the work on cancel and forgets it', async () => {
		const store = makeStore();
		let signal!: AbortSignal;
		const id = store.start('user:a', (s) => {
			signal = s;
			return new Promise<Response>(() => {});
		});
		expect(store.cancel(id, 'user:b')).toBe(false);
		expect(store.cancel(id, 'user:a')).toBe(true);
		expect(signal.aborted).toBe(true);
		expect(await store.read(id, 'user:a', 0)).toEqual({ kind: 'unknown' });
	});

	it('cancels a solve nobody polls, but not one a poll is waiting on', async () => {
		let now = 0;
		const store = makeStore({ abandonAfterMs: 60_000, now: () => now });
		const signals: AbortSignal[] = [];
		const work = () =>
			store.start(null, (s) => {
				signals.push(s);
				return new Promise<Response>(() => {});
			});
		const abandoned = work();
		const watched = work();
		const polling = store.read(watched, null, 200);

		now = 61_000;
		store.sweep();
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		expect(await store.read(abandoned, null, 0)).toEqual({ kind: 'unknown' });
		await polling;
	});

	it('drops results past their lifetime and the oldest ones past the byte cap', async () => {
		let now = 0;
		const store = makeStore({ resultTtlMs: 1_000, maxResultBytes: 4, now: () => now });
		const first = store.start(null, async () => new Response('abc'));
		await store.read(first, null, 100);
		now = 10;
		const second = store.start(null, async () => new Response('def'));
		await store.read(second, null, 100);
		expect(await store.read(first, null, 0)).toEqual({ kind: 'unknown' });

		now = 2_000;
		store.sweep();
		expect(await store.read(second, null, 0)).toEqual({ kind: 'unknown' });
	});
});

describe('wantsAsync', () => {
	it('reads respond-async among other preferences', () => {
		const req = (prefer: string) => new Request('http://x/', { headers: { Prefer: prefer } });
		expect(wantsAsync(req('selva-keepalive, respond-async'))).toBe(true);
		expect(wantsAsync(req('respond-async; wait=10'))).toBe(true);
		expect(wantsAsync(req('selva-keepalive'))).toBe(false);
	});
});

describe('followAsyncSolve', () => {
	const accepted = () => {
		const res = acceptedResponse('id-1', 'http://x/api/v1/solves/id-1');
		Object.defineProperty(res, 'url', { value: 'http://x/api/v1/compute' });
		return res;
	};

	it('passes a synchronous answer through untouched', async () => {
		const res = new Response('{}', { status: 200 });
		expect(await followAsyncSolve(res, { headers: {}, signal: new AbortController().signal })).toBe(
			res
		);
	});

	it('polls through 202s until the result', async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('{}', { status: 202 }))
			.mockResolvedValueOnce(new Response('done', { status: 200 }));
		const res = await followAsyncSolve(accepted(), {
			headers: { Authorization: 'Bearer t' },
			signal: new AbortController().signal,
			fetch: fetchMock
		});
		expect(await res!.text()).toBe('done');
		expect(String(fetchMock.mock.calls[0][0])).toBe('http://x/api/v1/solves/id-1?wait=25');
		expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer t' });
	});

	it('cancels the solve on the server when the caller aborts', async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
			if (init?.method === 'DELETE') return new Response(null, { status: 204 });
			controller.abort();
			throw new DOMException('aborted', 'AbortError');
		});
		const res = await followAsyncSolve(accepted(), {
			headers: {},
			signal: controller.signal,
			fetch: fetchMock
		});
		expect(res).toBeNull();
		expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
	});
});
