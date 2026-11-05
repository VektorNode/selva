import { describe, it, expect } from 'vitest';
import { createSolveCacheSingleFlight } from '../solve-cache-single-flight.js';

const live = () => new AbortController().signal;

function hungWork() {
	let seen!: AbortSignal;
	let release!: (value: number) => void;
	const gate = new Promise<number>((r) => (release = r));
	return {
		work: (signal: AbortSignal) => {
			seen = signal;
			return gate;
		},
		signal: () => seen,
		release
	};
}

describe('createSolveCacheSingleFlight', () => {
	it('coalesces concurrent identical calls into one execution', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		let release!: (v: number) => void;
		const gate = new Promise<number>((r) => (release = r));
		const work = () => {
			runs += 1;
			return gate;
		};
		const p1 = sf.run('k', work, live());
		const p2 = sf.run('k', work, live());
		expect(sf.inFlight()).toBe(1);
		release(7);
		expect(await p1).toBe(7);
		expect(await p2).toBe(7);
		expect(runs).toBe(1);
	});

	it('runs distinct keys independently', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		await Promise.all([
			sf.run('a', async () => void runs++, live()),
			sf.run('b', async () => void runs++, live())
		]);
		expect(runs).toBe(2);
	});

	it('releases the key after settle so a later call runs fresh', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		await sf.run('k', async () => void runs++, live());
		expect(sf.inFlight()).toBe(0);
		await sf.run('k', async () => void runs++, live());
		expect(runs).toBe(2);
	});

	it('a rejection is shared by concurrent waiters and still frees the key', async () => {
		const sf = createSolveCacheSingleFlight();
		const boom = () => Promise.reject(new Error('boom'));
		const p1 = sf.run('k', boom, live());
		const p2 = sf.run('k', boom, live());
		await expect(p1).rejects.toThrow('boom');
		await expect(p2).rejects.toThrow('boom');
		expect(sf.inFlight()).toBe(0);
	});

	it('a synchronous throw in work rejects instead of escaping run', async () => {
		const sf = createSolveCacheSingleFlight();
		const p = sf.run(
			'k',
			() => {
				throw new Error('sync');
			},
			live()
		);
		await expect(p).rejects.toThrow('sync');
		expect(sf.inFlight()).toBe(0);
	});

	it('fires onJoin for each joining caller, never for the one that starts the flight', async () => {
		const seen: string[] = [];
		const sf = createSolveCacheSingleFlight({ onJoin: (k) => seen.push(k) });
		const { work, release } = hungWork();

		const owner = sf.run('k', work, live());
		expect(seen).toEqual([]);
		sf.run('k', work, live());
		sf.run('k', work, live());
		expect(seen).toEqual(['k', 'k']);
		release(1);
		await owner;
	});

	it('a throwing onJoin does not fail the caller that joined', async () => {
		const sf = createSolveCacheSingleFlight({
			onJoin: () => {
				throw new Error('telemetry bug');
			}
		});
		const { work, release } = hungWork();
		const owner = sf.run('k', work, live());
		const joiner = sf.run('k', work, live());
		release(3);
		expect(await owner).toBe(3);
		expect(await joiner).toBe(3);
	});
});

describe('abort ownership', () => {
	it("a solo caller's abort aborts the work and frees the key", () => {
		const sf = createSolveCacheSingleFlight();
		const { work, signal } = hungWork();
		const caller = new AbortController();
		void sf.run('k', work, caller.signal);
		caller.abort();
		expect(signal().aborted).toBe(true);
		expect(sf.inFlight()).toBe(0);
	});

	it('one caller leaving keeps the work running for the rest', async () => {
		const sf = createSolveCacheSingleFlight();
		const { work, signal, release } = hungWork();
		const owner = new AbortController();
		const p = sf.run('k', work, owner.signal);
		const joiner = sf.run('k', work, live());
		owner.abort();
		expect(signal().aborted).toBe(false);
		expect(sf.inFlight()).toBe(1);
		release(5);
		expect(await joiner).toBe(5);
		expect(await p).toBe(5);
	});

	it('the work aborts when the last caller leaves, whichever order they went in', () => {
		const sf = createSolveCacheSingleFlight();
		const { work, signal } = hungWork();
		const owner = new AbortController();
		const joiner = new AbortController();
		void sf.run('k', work, owner.signal);
		void sf.run('k', work, joiner.signal);
		joiner.abort();
		expect(signal().aborted).toBe(false);
		owner.abort();
		expect(signal().aborted).toBe(true);
	});

	it('a caller arriving after the last one left starts a fresh flight', async () => {
		const sf = createSolveCacheSingleFlight();
		const { work, signal } = hungWork();
		const gone = new AbortController();
		void sf.run('k', work, gone.signal);
		gone.abort();

		let freshSignal!: AbortSignal;
		const fresh = await sf.run(
			'k',
			async (s) => {
				freshSignal = s;
				return 9;
			},
			live()
		);
		expect(fresh).toBe(9);
		expect(signal().aborted).toBe(true);
		expect(freshSignal.aborted).toBe(false);
	});

	it('a dying flight settling late does not free the fresh flight on its key', async () => {
		const sf = createSolveCacheSingleFlight();
		const old = hungWork();
		const gone = new AbortController();
		const dying = sf.run('k', old.work, gone.signal);
		gone.abort();

		const next = hungWork();
		const running = sf.run('k', next.work, live());
		old.release(1);
		await dying;
		expect(sf.inFlight()).toBe(1);
		next.release(2);
		expect(await running).toBe(2);
	});

	it('detaches from a caller signal once the flight settles', async () => {
		const sf = createSolveCacheSingleFlight();
		const controller = new AbortController();
		let attached = 0;
		const { signal } = controller;
		const add = signal.addEventListener.bind(signal);
		const remove = signal.removeEventListener.bind(signal);
		signal.addEventListener = ((...a: Parameters<typeof add>) => {
			attached += 1;
			return add(...a);
		}) as typeof add;
		signal.removeEventListener = ((...a: Parameters<typeof remove>) => {
			attached -= 1;
			return remove(...a);
		}) as typeof remove;

		await sf.run('k', async () => 1, signal);
		expect(attached).toBe(0);
	});
});
