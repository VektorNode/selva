/**
 * The callback Compute's plugin POSTs to mid-solve. It has no session, so the per-solve
 * bearer is the whole of its authentication, and a 410 is what tells the plugin to abort.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SolveEvent } from '@selvajs/schemas';
import { call } from '#lib/server/__tests__/fixtures.js';
import { getSolveEventBus } from '#lib/server/solveEvents/bus.server.js';
import { mintSolveToken } from '#lib/server/solveEvents/token.server.js';
import { POST } from '../+server.js';

const OWNER = 'user:alice';
const TTL_MS = 60_000;

/** A solve bound to a fresh stream, as `runSolve` leaves it; returns what that stream received. */
function openSolve() {
	const solveId = randomUUID();
	const streamId = `stream-${randomUUID()}`;
	const received: SolveEvent[] = [];
	getSolveEventBus().openStream(streamId, OWNER, (event) => received.push(event));
	getSolveEventBus().openSolve(solveId, streamId, OWNER);
	return { solveId, received };
}

function post(solveId: string, token: string | null) {
	return call(POST, {
		locals: {},
		params: { solveId },
		headers: token ? { authorization: `Bearer ${token}` } : {},
		body: { events: [{ type: 'diagnostic', at: 't', payload: { level: 'warning' } }] }
	});
}

describe('POST /api/v1/solve-events/{solveId}', () => {
	it("delivers events to the solve's stream and replies with the abort flag", async () => {
		const { solveId, received } = openSolve();

		const res = await post(solveId, mintSolveToken(solveId, TTL_MS));

		expect(res.status).toBe(200);
		expect(res.json).toEqual({ abort: false });
		expect(received.map((e) => e.type)).toEqual(['diagnostic']);
	});

	it.each([
		['no bearer', () => null],
		['a malformed bearer', () => 'not-a-token'],
		['an expired bearer', (id: string) => mintSolveToken(id, -1_000)],
		['a bearer minted for another solve', () => mintSolveToken(randomUUID(), TTL_MS)]
	])('refuses %s with 401 and delivers nothing', async (_, tokenFor) => {
		const { solveId, received } = openSolve();

		const res = await post(solveId, tokenFor(solveId));

		expect(res.status).toBe(401);
		expect(received).toEqual([]);
	});

	it('answers 410 once the solve is closed, so the plugin stops', async () => {
		const { solveId, received } = openSolve();
		getSolveEventBus().closeSolve(solveId);

		const res = await post(solveId, mintSolveToken(solveId, TTL_MS));

		expect(res.status).toBe(410);
		expect(received).toEqual([]);
	});

	it('carries an abort the owner requested back in the reply', async () => {
		const { solveId } = openSolve();
		getSolveEventBus().requestAbort(solveId, OWNER);

		const res = await post(solveId, mintSolveToken(solveId, TTL_MS));

		expect(res.json).toEqual({ abort: true });
	});
});
