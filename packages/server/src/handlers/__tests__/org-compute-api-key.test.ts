/**
 * The apiKey merge as the org compute write applies it. The rules have unit
 * tests of their own; these catch a handler that stops calling them, which
 * clears or leaks a stored credential without failing anything else.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedUser, seedOrgMember, actAs, callHandler } from '../../testing/index.js';
import { updateOrgCompute } from '../orgCompute.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_URL = 'http://compute.acme.test:6500';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

/** An org owner who has saved one server with `stored-key`. */
async function withStoredKey() {
	const h = await freshHarness({ flags: { ALLOW_ORG_COMPUTE_OVERRIDE: true } });
	tp = h;
	const { acme } = await seedAcme(h);
	const owner = await seedUser(h, 'owner@acme.test');
	await seedOrgMember(h, {
		orgId: acme.id,
		userId: owner.id,
		role: 'owner',
		permissions: ['manage_org_compute']
	});
	const locals = await actAs(h, owner.id);

	const save = (server: { serverUrl?: string; apiKey?: string | null }) =>
		callHandler(updateOrgCompute, {
			locals,
			params: { orgId: acme.id },
			method: 'PUT',
			body: {
				servers: [{ id: SERVER_ID, label: 'Acme compute', serverUrl: SERVER_URL, ...server }]
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
	return { save, storedKey };
}

describe('PUT /api/v1/orgs/[orgId]/compute apiKey', () => {
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

	it('refuses a new URL that would carry the stored key to it', async () => {
		const { save, storedKey } = await withStoredKey();
		const res = await save({ serverUrl: 'https://attacker.example' });
		expect(res.status).toBe(409);
		expect(res.json).toMatchObject({ code: 'CONFLICT' });
		expect(await storedKey()).toBe('stored-key');
	});

	it('moves the server once its key is re-entered', async () => {
		const { save, storedKey } = await withStoredKey();
		const res = await save({ serverUrl: 'https://new.acme.test', apiKey: 'new-key' });
		expect(res.status).toBe(204);
		expect(await storedKey()).toBe('new-key');
	});
});
