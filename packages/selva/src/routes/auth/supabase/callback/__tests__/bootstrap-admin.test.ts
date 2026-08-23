/**
 * Spec §2 — first-OAuth-signin-becomes-instance-admin.
 *
 * The OAuth callback grants every platform permission to the signing-in user
 * iff (a) no instance_admin currently exists AND (b) either
 * `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is unset OR the user's email matches it.
 *
 * The unset-env-var case is the "fresh self-hosted install" path; the
 * matching-email case is the production hardening / break-glass recovery
 * path. A non-matching email or an existing admin both lock the path down.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
	freshProviders,
	installOAuthShim,
	seedUser,
	setEnv,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { issueOAuthState } from '$lib/server/auth/oauthState.server.js';
import { GET } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
	await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', undefined);
});

beforeEach(async () => {
	await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', undefined);
});

async function callback(opts: { code: string }): Promise<{
	status: number;
	location?: string;
	json?: unknown;
}> {
	// A real jar, because the callback consumes the CSRF state nonce out of it
	// before anything else runs. Issuing one here is the same thing
	// `/auth/supabase/start` does — these tests are about the bootstrap grant,
	// not the gate, and `oauthState.test.ts` covers the gate on its own.
	const jar = new Map<string, string>();
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => void jar.set(name, value),
		delete: (name: string) => void jar.delete(name),
		getAll: () => [...jar].map(([name, value]) => ({ name, value }))
	};
	const state = issueOAuthState(cookies as never);

	const event = {
		url: new URL(`http://test.local/auth/supabase/callback?code=${opts.code}&selva_state=${state}`),
		params: {},
		request: new Request('http://test.local/'),
		locals: {},
		cookies,
		setHeaders: () => {},
		fetch,
		platform: undefined,
		route: { id: null },
		isDataRequest: false,
		isSubRequest: false
	};
	try {
		const result = (await GET(event as never)) as Response | undefined;
		if (!(result instanceof Response)) return { status: 200 };
		return {
			status: result.status,
			location: result.headers.get('location') ?? undefined,
			json: result.headers.get('content-type')?.includes('json') ? await result.json() : undefined
		};
	} catch (err) {
		const e = err as { status?: number; location?: string; body?: unknown };
		if (typeof e.status === 'number') {
			return { status: e.status, location: e.location, json: e.body };
		}
		throw err;
	}
}

describe('OAuth callback bootstrap admin grant', () => {
	it('Fresh instance, no env var → first OAuth signer becomes admin', async () => {
		tp = await freshProviders();
		installOAuthShim(tp, { email: 'first@example.test' });

		const res = await callback({ code: 'fake-code' });
		expect(res.status).toBe(303);
		expect(res.location).toBe('/library');

		const newUser = await tp.authUsers.findByEmail('first@example.test');
		expect(newUser).not.toBeNull();
		const perms = await tp.config.data.permissions.getFor(
			{ userId: newUser!.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
			newUser!.id
		);
		expect(perms).toContain('instance_admin');
	});

	it('Fresh instance, env var matches signer → admin granted', async () => {
		tp = await freshProviders();
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'operator@example.test');
		installOAuthShim(tp, { email: 'operator@example.test' });

		const res = await callback({ code: 'fake-code' });
		expect(res.status).toBe(303);

		const operator = await tp.authUsers.findByEmail('operator@example.test');
		const perms = await tp.config.data.permissions.getFor(
			{ userId: operator!.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
			operator!.id
		);
		expect(perms).toContain('instance_admin');
	});

	it('Fresh instance, env var mismatches signer → no admin granted', async () => {
		tp = await freshProviders();
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'operator@example.test');
		installOAuthShim(tp, { email: 'random@example.test' });

		const res = await callback({ code: 'fake-code' });
		expect(res.status).toBe(303);

		const random = await tp.authUsers.findByEmail('random@example.test');
		const perms = await tp.config.data.permissions.getFor(
			{ userId: random!.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
			random!.id
		);
		expect(perms).not.toContain('instance_admin');
	});

	it('Existing admin present → bootstrap path skipped even with matching email', async () => {
		tp = await freshProviders();
		// Pre-existing admin Alice.
		const alice = await seedUser(tp, 'alice@acme.test', ['instance_admin']);
		expect(
			await tp.config.data.permissions.getFor(
				{ userId: alice.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
				alice.id
			)
		).toContain('instance_admin');

		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'operator@example.test');
		installOAuthShim(tp, { email: 'operator@example.test' });

		const res = await callback({ code: 'fake-code' });
		expect(res.status).toBe(303);

		const operator = await tp.authUsers.findByEmail('operator@example.test');
		const perms = await tp.config.data.permissions.getFor(
			{ userId: operator!.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
			operator!.id
		);
		expect(perms).not.toContain('instance_admin');
	});

	// In multi-tenant mode the first OAuth signer must NOT win the race —
	// without the env var, a random SaaS signup would become Selva staff.
	// Operators seed admin explicitly via BOOTSTRAP_INSTANCE_ADMIN_EMAIL.
	it('Multi-tenant, no env var → bootstrap disabled, first signer is NOT admin', async () => {
		tp = await freshProviders({ tenancy: 'multi' });
		installOAuthShim(tp, { email: 'random@example.test' });

		const res = await callback({ code: 'fake-code' });
		expect(res.status).toBe(303);

		const random = await tp.authUsers.findByEmail('random@example.test');
		const perms = await tp.config.data.permissions.getFor(
			{ userId: random!.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
			random!.id
		);
		expect(perms).not.toContain('instance_admin');
	});

	it('Multi-tenant, env var matches signer → admin granted (staff seed / break-glass)', async () => {
		tp = await freshProviders({ tenancy: 'multi' });
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'staff@selva.test');
		installOAuthShim(tp, { email: 'staff@selva.test' });

		const res = await callback({ code: 'fake-code' });
		expect(res.status).toBe(303);

		const staff = await tp.authUsers.findByEmail('staff@selva.test');
		const perms = await tp.config.data.permissions.getFor(
			{ userId: staff!.id, platformPermissions: ['instance_admin'], orgPermissions: [] },
			staff!.id
		);
		expect(perms).toContain('instance_admin');
	});
});

/**
 * SEL-5. The callback is a GET that sets a session cookie, so SvelteKit's CSRF
 * origin check does not reach it. Without the state nonce an attacker replays
 * their own `?code=` into the victim's browser and the victim ends up signed
 * into the attacker's account.
 */
describe('OAuth callback CSRF state', () => {
	async function callbackWithoutState(): Promise<number> {
		const event = {
			url: new URL('http://test.local/auth/supabase/callback?code=fake-code'),
			params: {},
			request: new Request('http://test.local/'),
			locals: {},
			cookies: { get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] },
			setHeaders: () => {},
			fetch,
			platform: undefined,
			route: { id: null },
			isDataRequest: false,
			isSubRequest: false
		};
		try {
			await GET(event as never);
			return 200;
		} catch (err) {
			return (err as { status?: number }).status ?? 500;
		}
	}

	it('refuses a callback carrying no state, before the code is exchanged', async () => {
		tp = await freshProviders();
		installOAuthShim(tp, { email: 'victim@example.test' });
		expect(await callbackWithoutState()).toBe(400);
		// The exchange never ran, so no user was created.
		expect(await tp.authUsers.findByEmail('victim@example.test')).toBeNull();
	});
});
