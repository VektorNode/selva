import { describe, it, expect, afterEach } from 'vitest';
import { parseApiScope } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, actAs, callHandler } from '../../testing/index.js';
import { getMe } from '../me.js';

let h: HandlerHarness | null = null;

afterEach(async () => {
	await h?.cleanup();
	h = null;
});

describe('GET /me', () => {
	it("names a token's scopes and expiry, so a client can tell what the key may do", async () => {
		h = await freshHarness();
		const { alice } = await seedAcme(h);
		const locals = await actAs(h, alice.id);
		locals.ctx = {
			...locals.ctx,
			apiScope: {
				tokenId: 't1',
				scopes: [parseApiScope('solve:all')!],
				expiresAt: '2099-01-01T00:00:00.000Z'
			}
		};
		const res = await callHandler(getMe, { locals });
		expect(res.json).toMatchObject({
			apiToken: { id: 't1', scopes: ['solve:all'], expiresAt: '2099-01-01T00:00:00.000Z' }
		});
	});

	it('has no token block for a browser session', async () => {
		h = await freshHarness();
		const { alice } = await seedAcme(h);
		const res = await callHandler(getMe, { locals: await actAs(h, alice.id) });
		expect(res.json).not.toHaveProperty('apiToken');
	});
});
