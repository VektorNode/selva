import { describe, it, expect, afterEach } from 'vitest';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { actAs, callHandler, seedAcme, seedBigClient } from '../../testing/index.js';
import { getOrgCompute } from '../orgCompute.js';

let h: HandlerHarness | null = null;

afterEach(async () => {
	await h?.cleanup();
	h = null;
});

async function world(flag: boolean) {
	h = await freshHarness({ flags: { ALLOW_ORG_COMPUTE_OVERRIDE: flag } });
	return { ...(await seedAcme(h)), ...(await seedBigClient(h)) };
}

const read = async (userId: string, orgId: string) =>
	callHandler(getOrgCompute, { locals: await actAs(h!, userId), params: { orgId } });

describe('GET /orgs/{orgId}/compute', () => {
	it('answers an org admin while ALLOW_ORG_COMPUTE_OVERRIDE is on', async () => {
		const w = await world(true);
		const res = await read(w.alice.id, w.acme.id);
		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ servers: [], catalog: [] });
	});

	it('refuses even an org admin while the flag is off', async () => {
		const w = await world(false);
		const res = await read(w.alice.id, w.acme.id);
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({
			code: 'FORBIDDEN',
			message: expect.stringContaining('ALLOW_ORG_COMPUTE_OVERRIDE')
		});
	});

	it('refuses a member without manage_org_compute', async () => {
		const w = await world(true);
		const res = await read(w.bob.id, w.acme.id);
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ message: `You don't have permission to do this.` });
	});

	it('refuses an admin naming another org', async () => {
		const w = await world(true);
		const res = await read(w.alice.id, w.bigClient.id);
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ message: 'Acting org does not match the target org.' });
	});
});
