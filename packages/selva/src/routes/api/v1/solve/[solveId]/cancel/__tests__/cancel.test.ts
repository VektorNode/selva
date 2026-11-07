/**
 * Cancelling a running solve. Only the owner of the stream that started it may: anyone else
 * gets the same 404 as for a solve that does not exist, and the solve keeps running.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
	actAs,
	anon,
	call,
	freshProviders,
	seedAcme,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { getSolveEventBus } from '#lib/server/solveEvents/bus.server.js';
import { liveOwnerKey } from '#lib/server/solveEvents/liveSolve.server.js';
import { POST } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

/** A solve Alice started from her own stream. */
async function alicesSolve() {
	tp = await freshProviders();
	const cast = await seedAcme(tp);
	const owner = liveOwnerKey(cast.alice.id)!;
	const solveId = randomUUID();
	const streamId = `stream-${randomUUID()}`;
	getSolveEventBus().openStream(streamId, owner, () => {});
	getSolveEventBus().openSolve(solveId, streamId, owner);
	return { ...cast, solveId };
}

/** What the plugin's next callback reply would carry. */
const abortPending = (solveId: string) => getSolveEventBus().publish(solveId, []).abort;

describe('POST /api/v1/solve/{solveId}/cancel', () => {
	it('lets the owner flag the solve for abort', async () => {
		const { alice, solveId } = await alicesSolve();

		const res = await call(POST, { locals: await actAs(tp!, alice.id), params: { solveId } });

		expect(res.status).toBe(204);
		expect(abortPending(solveId)).toBe(true);
	});

	it('answers 404 to another user and leaves the solve running', async () => {
		const { bob, solveId } = await alicesSolve();

		const res = await call(POST, { locals: await actAs(tp!, bob.id), params: { solveId } });

		expect(res.status).toBe(404);
		expect(abortPending(solveId)).toBe(false);
	});

	it('refuses an anonymous caller with 401', async () => {
		const { solveId } = await alicesSolve();

		const res = await call(POST, { locals: anon(tp!), params: { solveId } });

		expect(res.status).toBe(401);
		expect(abortPending(solveId)).toBe(false);
	});
});
