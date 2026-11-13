/**
 * `/setup` is a public route, so its `load` guard is not a control — a direct
 * POST never runs it. The action mints a user holding ALL_PLATFORM_PERMISSIONS
 * and signs them in, which makes an unguarded action an unauthenticated path to
 * instance admin on a fully-configured deployment.
 *
 * Duplicate-email rejection is not the guard: a fresh address sails past it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedUser,
	setEnv,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { setupToken } from '@selvajs/platform/config';
import { env } from '#lib/server/env.js';
import { actions, load } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
	await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', undefined);
});

function formRequest(fields: Record<string, string>): Request {
	const body = new URLSearchParams(fields);
	return new Request('http://test.local/setup', { method: 'POST', body });
}

const validToken = () => setupToken(env.SELVA_HMAC_KEY!);

/** Enough of SvelteKit's `Cookies` for `load`: one browser's jar. */
function cookieJar() {
	const jar = new Map<string, string>();
	return {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => void jar.set(name, value),
		delete: (name: string) => void jar.delete(name)
	};
}

const loadSetup = (url: string, cookies = cookieJar()) =>
	load({ url: new URL(url), cookies } as never);

async function runSetup(
	tp: TestProviders,
	fields: Record<string, string>,
	token: string | null = validToken()
) {
	const cookies = { set: () => {}, get: () => undefined, delete: () => {} };
	return actions.default({
		request: formRequest(token === null ? fields : { ...fields, token }),
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

	it('refuses any email but the pinned bootstrap admin on a fresh instance', async () => {
		// An empty instance is claimable by whoever reaches /setup first, so the
		// pin has to hold for the password form too, not only for OAuth and proxy.
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'operator@acme.test');
		tp = await freshProviders();
		const before = await tp.authUsers.listUsers();

		const result = (await runSetup(tp, {
			companyName: 'Attacker Co',
			email: 'attacker@evil.test',
			password: 'hunter2hunter2',
			confirm: 'hunter2hunter2'
		})) as { status?: number };

		expect(result?.status).toBe(403);
		expect(await tp.authUsers.listUsers()).toHaveLength(before.length);
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(false);
	});

	it('accepts the pinned bootstrap admin regardless of case', async () => {
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'Operator@Acme.test');
		tp = await freshProviders();

		const result = (await runSetup(tp, {
			companyName: 'Acme',
			email: 'operator@acme.test',
			password: 'hunter2hunter2',
			confirm: 'hunter2hunter2'
		}).catch((thrown) => thrown)) as { status?: number };

		expect(result?.status).toBe(303);
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(true);
	});

	it('refuses a fresh instance to a caller without the setup token', async () => {
		tp = await freshProviders();
		const fields = {
			companyName: 'Attacker Co',
			email: 'attacker@evil.test',
			password: 'hunter2hunter2',
			confirm: 'hunter2hunter2'
		};

		for (const token of [null, '', 'x'.repeat(43)]) {
			const result = (await runSetup(tp, fields, token)) as { status?: number };
			expect(result?.status).toBe(403);
		}
		expect(await tp.authUsers.listUsers()).toHaveLength(0);
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(false);
	});

	it('keeps the pinned admin email out of the public page data', async () => {
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'operator@acme.test');
		tp = await freshProviders();

		const data = await loadSetup('http://test.local/setup');

		expect(JSON.stringify(data)).not.toContain('operator@acme.test');
		expect(data).toMatchObject({ hasPasswordAuth: true, setupToken: null, pinned: true });
	});

	it('hands the token back to the form only when the link carries it', async () => {
		tp = await freshProviders();
		const token = validToken();

		expect(await loadSetup(`http://test.local/setup?token=${token}`)).toMatchObject({
			setupToken: token
		});
		expect(await loadSetup('http://test.local/setup?token=forged')).toMatchObject({
			setupToken: null
		});
	});

	it('remembers the link in this browser for the sign-in round-trip', async () => {
		tp = await freshProviders();
		const token = validToken();
		const browser = cookieJar();

		await loadSetup(`http://test.local/setup?token=${token}`, browser);

		expect(await loadSetup('http://test.local/setup', browser)).toMatchObject({
			setupToken: token
		});
		expect(await loadSetup('http://test.local/setup')).toMatchObject({ setupToken: null });
	});

	it('mints one admin when two setups are posted together', async () => {
		tp = await freshProviders();
		const post = (email: string) =>
			runSetup(tp!, {
				companyName: 'Acme',
				email,
				password: 'hunter2hunter2',
				confirm: 'hunter2hunter2'
			}).catch((thrown) => thrown) as Promise<{ status?: number }>;

		const results = await Promise.all([post('founder@acme.test'), post('racer@evil.test')]);

		expect(results.map((r) => r?.status).sort()).toEqual([303, 403]);
		const users = await tp.authUsers.listUsers();
		expect(users).toHaveLength(1);
		expect(
			await tp.config.data.permissions.countInstanceAdminsExcluding(SYSTEM_CONTEXT, users[0].id)
		).toBe(0);
	});
});

describe('/setup action: a claim that errors', () => {
	it('reports a failure, not a finished setup, and leaves no account', async () => {
		tp = await freshProviders();
		vi.spyOn(tp.config.data.permissions, 'claimFirstInstanceAdmin').mockRejectedValue(
			new Error('connection reset')
		);

		const result = (await runSetup(tp, {
			companyName: 'Acme',
			email: 'founder@acme.test',
			password: 'hunter2hunter2',
			confirm: 'hunter2hunter2'
		})) as { status?: number; data?: { error?: string } };

		expect(result?.status).toBe(500);
		expect(result?.data?.error).not.toMatch(/already set up/);
		expect(await tp.authUsers.listUsers()).toHaveLength(0);
	});
});
