import { describe, it, expect, afterEach, vi } from 'vitest';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedUser, seedOrgMember, actAs, callHandler } from '../../testing/index.js';
import { updateOrgCompute } from '../orgCompute.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

describe('PUT /api/orgs/[orgId]/compute', () => {
	it('tells the host the config changed, so remembered servers are read again', async () => {
		tp = await freshHarness({ flags: { ALLOW_ORG_COMPUTE_OVERRIDE: true } });
		const { acme } = await seedAcme(tp);
		const owner = await seedUser(tp, 'owner@acme.test');
		await seedOrgMember(tp, {
			orgId: acme.id,
			userId: owner.id,
			role: 'owner',
			permissions: ['manage_org_compute']
		});
		const onComputeConfigSaved = vi.fn();
		tp.deps = { ...tp.deps, onComputeConfigSaved };

		const res = await callHandler(updateOrgCompute, {
			locals: await actAs(tp, owner.id),
			params: { orgId: acme.id },
			method: 'PUT',
			body: { servers: [], defaultServerId: null }
		});

		expect(res.status).toBe(204);
		expect(onComputeConfigSaved).toHaveBeenCalledTimes(1);
	});
});
