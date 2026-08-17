/**
 * `/setup` is a public route, so its `load` guard is not a control — a direct
 * POST never runs it. The action mints a user holding ALL_PLATFORM_PERMISSIONS
 * and signs them in, which makes an unguarded action an unauthenticated path to
 * instance admin on a fully-configured deployment.
 *
 * Duplicate-email rejection is not the guard: a fresh address sails past it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshProviders, seedUser, type TestProviders } from '$lib/server/__tests__/fixtures.js';
import { actions } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

function formRequest(fields: Record<string, string>): Request {
	const body = new URLSearchParams(fields);
	return new Request('http://test.local/setup', { method: 'POST', body });
}

async function runSetup(tp: TestProviders, fields: Record<string, string>) {
	const cookies = { set: () => {}, get: () => undefined, delete: () => {} };
	return actions.default({
		request: formRequest(fields),
		cookies,
		locals: { log: { error: () => {}, warn: () => {}, info: () => {} } }
	} as never);
}

describe('/setup action — re-entry after an admin exists', () => {
	it('refuses to mint a second admin with an unregistered email', async () => {
		tp = await freshProviders();
		const existing = await seedUser(tp, 'admin@acme.test');
		await tp.config.data.permissions.set(SYSTEM_CONTEXT, existing.id, ['instance_admin']);

		const before = await tp.authUsers.listUsers();

		const result = (await runSetup(tp, {
			companyName: 'Attacker Co',
			email: 'attacker@evil.test',
			password: 'hunter2hunter2',
			confirm: 'hunter2hunter2'
		})) as { status?: number };

		expect(result?.status).toBe(403);

		// No account created, and no second admin.
		const after = await tp.authUsers.listUsers();
		expect(after).toHaveLength(before.length);
		expect(
			await tp.config.data.permissions.countInstanceAdminsExcluding(SYSTEM_CONTEXT, existing.id)
		).toBe(0);
	});

	it('still allows first-run setup on a fresh instance', async () => {
		// The guard must not brick the case it is wrapped around.
		tp = await freshProviders();
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(false);

		const result = (await runSetup(tp, {
			companyName: 'Acme',
			email: 'founder@acme.test',
			password: 'hunter2hunter2',
			confirm: 'hunter2hunter2'
		}).catch((thrown) => thrown)) as { status?: number };

		// The happy path ends in `redirect(303, '/admin')`, which SvelteKit throws.
		expect(result?.status).toBe(303);
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(true);
	});
});
