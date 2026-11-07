/**
 * SvelteKit answers 500 for any throw that isn't an `HttpError`, so a guard's
 * `ApiError` reaches the client as the right status only through `apiRoute`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { isApiError } from '@selvajs/server/api';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import * as config from '../+server.js';
import * as actions from '../actions/+server.js';
import * as status from '../status/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

type Handler = Parameters<typeof call>[0];

/** `call` reads a raw `ApiError` as its own status, which would hide the 500. */
function failOnRawApiError(handler: Handler): Handler {
	return async (event) => {
		try {
			return await handler(event);
		} catch (err) {
			if (isApiError(err))
				throw new Error(`ApiError ${err.status} escaped the route`, { cause: err });
			throw err;
		}
	};
}

describe('/api/admin/compute/* without manage_compute', () => {
	it.each([
		['GET /api/admin/compute', config.GET, undefined, undefined],
		['PUT /api/admin/compute', config.PUT, 'PUT', { servers: [] }],
		['POST /api/admin/compute/actions', actions.POST, 'POST', { action: 'clear-solve-cache' }],
		['GET /api/admin/compute/status', status.GET, 'GET', undefined]
	] as const)('%s answers 403', async (_name, handler, method, body) => {
		tp = await freshProviders();
		const { bob } = await seedAcme(tp);
		const res = await call(failOnRawApiError(handler as Handler), {
			locals: await actAs(tp, bob.id),
			method,
			body,
			url: 'http://test.local/?serverId=11111111-1111-4111-8111-111111111111'
		});
		expect(res.status).toBe(403);
	});
});
