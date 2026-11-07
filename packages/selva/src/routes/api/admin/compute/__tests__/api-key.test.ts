/**
 * The apiKey merge as the platform compute write applies it. Its org sibling
 * runs the same rules; if the two disagree, a stored credential is cleared or
 * handed to a new URL and nothing else fails.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { isApiError } from '@selvajs/server/api';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { GET, PUT } from '../+server.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_URL = 'http://compute.internal:6500';

let tp: TestProviders | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

/**
 * `call` reads a raw `ApiError` as its own status, but SvelteKit answers 500
 * for anything that isn't an `HttpError`, so one escaping the route is a bug.
 */
function failOnRawApiError<H extends typeof GET | typeof PUT>(handler: H): H {
	return (async (event: Parameters<H>[0]) => {
		try {
			return await handler(event as never);
		} catch (err) {
			if (isApiError(err))
				throw new Error(`ApiError ${err.status} escaped the route`, { cause: err });
			throw err;
		}
	}) as H;
}

const get = failOnRawApiError(GET);
const put = failOnRawApiError(PUT);

/** A `manage_compute` operator who has saved one platform server with `stored-key`. */
async function withStoredKey() {
	const h = await freshProviders();
	tp = h;
	const { alice } = await seedAcme(h);
	await grantPlatformPermissions(h, alice.id, ['manage_compute']);
	const locals = await actAs(h, alice.id);

	const save = (server: { serverUrl?: string; apiKey?: string | null }) =>
		call(put, {
			locals,
			method: 'PUT',
			body: {
				servers: [
					{
						id: SERVER_ID,
						label: 'Shared compute',
						serverUrl: SERVER_URL,
						sharedWith: 'all',
						...server
					}
				],
				defaultServerId: SERVER_ID
			}
		});

	const storedKey = async () => {
		const config = await h.config.data.computeServer.getConfig(SYSTEM_CONTEXT, {
			includeApiKeys: true
		});
		return config.servers.find((s) => s.id === SERVER_ID)?.apiKey;
	};

	expect((await save({ apiKey: 'stored-key' })).status).toBe(204);
	expect(await storedKey()).toBe('stored-key');
	return { locals, save, storedKey };
}

describe('PUT /api/admin/compute apiKey', () => {
	it('keeps the stored key when the field is omitted', async () => {
		const { save, storedKey } = await withStoredKey();
		expect((await save({})).status).toBe(204);
		expect(await storedKey()).toBe('stored-key');
	});

	it('keeps the stored key on an empty string, which an untouched password field submits', async () => {
		const { save, storedKey } = await withStoredKey();
		expect((await save({ apiKey: '' })).status).toBe(204);
		expect(await storedKey()).toBe('stored-key');
	});

	it('clears the key on null', async () => {
		const { save, storedKey } = await withStoredKey();
		expect((await save({ apiKey: null })).status).toBe(204);
		expect(await storedKey()).toBeUndefined();
	});

	it('replaces the key with a new value', async () => {
		const { save, storedKey } = await withStoredKey();
		expect((await save({ apiKey: 'rotated-key' })).status).toBe(204);
		expect(await storedKey()).toBe('rotated-key');
	});

	it('refuses a new URL that would carry the stored key to it, with 409', async () => {
		const { save, storedKey } = await withStoredKey();
		const res = await save({ serverUrl: 'https://attacker.example' });
		expect(res.status).toBe(409);
		expect(res.json).toMatchObject({ code: 'CONFLICT' });
		expect(await storedKey()).toBe('stored-key');
	});

	it('moves the server once its key is re-entered', async () => {
		const { save, storedKey } = await withStoredKey();
		const res = await save({ serverUrl: 'https://new.internal', apiKey: 'new-key' });
		expect(res.status).toBe(204);
		expect(await storedKey()).toBe('new-key');
	});
});

describe('GET /api/admin/compute', () => {
	it('never returns a stored key', async () => {
		const { locals } = await withStoredKey();
		const res = await call(get, { locals });
		expect(res.status).toBe(200);
		expect(res.text).not.toContain('stored-key');
		expect(res.json).toMatchObject({ servers: [{ id: SERVER_ID, hasApiKey: true }] });
	});
});
