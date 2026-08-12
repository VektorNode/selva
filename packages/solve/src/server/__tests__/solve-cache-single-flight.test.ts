/**
 * In-process single-flight — coalescing, release-on-settle, and the
 * owner-notification the route uses to decide abort semantics.
 */

import { describe, it, expect } from 'vitest';
import { createSolveCacheSingleFlight } from '../solve-cache-single-flight.js';

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
		const p1 = sf.run('k', work);
		const p2 = sf.run('k', work);
		expect(sf.inFlight()).toBe(1);
		release(7);
		expect(await p1).toBe(7);
		expect(await p2).toBe(7);
		expect(runs).toBe(1);
	});

	it('runs distinct keys independently', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		await Promise.all([sf.run('a', async () => void runs++), sf.run('b', async () => void runs++)]);
		expect(runs).toBe(2);
	});

	it('releases the key after settle so a later call runs fresh', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		await sf.run('k', async () => void runs++);
		expect(sf.inFlight()).toBe(0);
		await sf.run('k', async () => void runs++);
		expect(runs).toBe(2);
	});

	it('a rejection is shared by concurrent waiters and still frees the key', async () => {
		const sf = createSolveCacheSingleFlight();
		const boom = () => Promise.reject(new Error('boom'));
		const p1 = sf.run('k', boom);
		const p2 = sf.run('k', boom);
		await expect(p1).rejects.toThrow('boom');
		await expect(p2).rejects.toThrow('boom');
		expect(sf.inFlight()).toBe(0);
	});

	// --- owner notification -------------------------------------------------
	// The route reads this to choose an abort signal: a solo flight may cancel on
	// its client's disconnect, a shared one may not (it would 499 every waiter).

	it('notifies the owner when a waiter joins its flight', async () => {
		const sf = createSolveCacheSingleFlight();
		let joins = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));

		const owner = sf.run(
			'k',
			() => gate,
			() => void joins++
		);
		expect(joins).toBe(0);

		sf.run('k', () => gate);
		expect(joins).toBe(1);
		sf.run('k', () => gate);
		expect(joins).toBe(2);

		release();
		await owner;
	});

	it('does not notify a solo owner', async () => {
		const sf = createSolveCacheSingleFlight();
		let joins = 0;
		await sf.run(
			'k',
			async () => 1,
			() => void joins++
		);
		expect(joins).toBe(0);
	});

	it('never notifies the joiner, only the owner', async () => {
		const sf = createSolveCacheSingleFlight();
		let ownerJoins = 0;
		let joinerJoins = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));

		const owner = sf.run(
			'k',
			() => gate,
			() => void ownerJoins++
		);
		sf.run(
			'k',
			() => gate,
			() => void joinerJoins++
		);

		expect(ownerJoins).toBe(1);
		expect(joinerJoins).toBe(0);
		release();
		await owner;
	});

	it('stops notifying once the flight has settled', async () => {
		const sf = createSolveCacheSingleFlight();
		let joins = 0;
		await sf.run(
			'k',
			async () => 1,
			() => void joins++
		);

		// A later call for the same key is a new flight, not a join.
		await sf.run('k', async () => 2);
		expect(joins).toBe(0);
	});

	it('fires onJoin for observability independently of the owner callback', async () => {
		const seen: string[] = [];
		const sf = createSolveCacheSingleFlight({ onJoin: (k) => seen.push(k) });
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));

		const owner = sf.run('k', () => gate);
		sf.run('k', () => gate);
		expect(seen).toEqual(['k']);
		release();
		await owner;
	});
});
