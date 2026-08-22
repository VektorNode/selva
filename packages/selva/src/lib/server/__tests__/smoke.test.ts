/**
 * Smoke test for the test infrastructure itself: `freshProviders()` +
 * `setTestProviders()` + `actAs()` + `call()` end to end, so other test files
 * have a known-good baseline to build on.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { freshProviders, seedAcme, actAs, call, type TestProviders } from './fixtures.js';
import { POST } from '../../../routes/api/v1/projects/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('smoke: test infrastructure', () => {
	it('freshProviders + seedAcme + actAs roundtrips', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		expect(locals.user.id).toBe(alice.id);
		expect(locals.ctx.userId).toBe(alice.id);
		expect(locals.ctx.actingOrgId).toBe(acme.id);
		expect(locals.ctx.orgPermissions.length).toBeGreaterThan(0); // admin gets all
	});

	it('POST /api/v1/projects respects canCreateProject — Bob (member) is rejected', async () => {
		tp = await freshProviders();
		const { bob } = await seedAcme(tp);
		const locals = await actAs(tp, bob.id);

		const res = await call(POST, {
			locals,
			body: { name: 'Bob Project', visibility: 'private' }
		});
		expect(res.status).toBe(403);
	});

	it('POST /api/projects allows Alice (admin) to create a project', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			body: { name: 'Alice New Project', visibility: 'private' }
		});
		expect(res.status).toBe(201);
		const created = res.json as { name: string; ownerId: string };
		expect(created.name).toBe('Alice New Project');
		expect(created.ownerId).toBe(alice.id);
	});
});
