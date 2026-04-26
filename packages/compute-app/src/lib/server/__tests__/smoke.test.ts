/**
 * Smoke test for the test infrastructure itself. Validates that:
 *  - `freshProviders()` builds a working provider stack in a tmpdir.
 *  - `setTestProviders()` makes the stack visible to the mocked
 *    `$lib/server/providers.server` so route handlers see it.
 *  - `actAs()` produces a usable `App.Locals`.
 *  - `call()` invokes a real `+server.ts` handler and surfaces its result.
 *
 * If this file passes, Phase 2/3 tests have a known-good baseline to build on.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { freshProviders, seedAcme, actAs, call, type TestProviders } from './fixtures.js';
import { GET, POST } from '../../../routes/api/projects/+server.js';

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

	it('GET /api/projects via call() returns the seeded org\'s projects', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await call(GET, { locals });
		expect(res.status).toBe(200);
		const body = res.json as { projects: Array<{ name: string }> };
		expect(body.projects.map((p) => p.name).sort()).toEqual([
			'Acme Org Project',
			'Acme Public',
			'Alice Private'
		]);
	});

	it('POST /api/projects respects canCreateProject — Bob (member) is rejected', async () => {
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
