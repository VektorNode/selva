/**
 * The password form action against the real login limiter: failures spend the caller's
 * budget, a success forgives it, and the redirect after sign-in never leaves this origin.
 *
 * The limiter is module state with no reset, so every test signs in from its own address
 * and as its own account.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	grantPlatformPermissions,
	silentLog,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { actions } from '../+page.server.js';

const PASSWORD = 'correct-horse-battery';
/** The address bucket's cap: the attempt after this many failures is refused. */
const ADDRESS_CAP = 5;

let tp: TestProviders | null = null;
let nextAddress = 1;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

/** A fresh instance with one admin who signs in with `PASSWORD`, at an unused address. */
async function setup() {
	tp = await freshProviders();
	const n = nextAddress++;
	const email = `admin${n}@acme.test`;
	const user = await tp.config.auth.passwordAuth!.createUserWithPassword(email, PASSWORD);
	await tp.config.data.ensureUser(SYSTEM_CONTEXT, user.id);
	await grantPlatformPermissions(tp, user.id, ['instance_admin']);
	return { email, ip: `203.0.113.${n}` };
}

interface Outcome {
	status: number;
	error?: string;
	location?: string;
	cookies: Map<string, string>;
}

async function signIn(
	ip: string,
	fields: Record<string, string>,
	url = 'http://test.local/login'
): Promise<Outcome> {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const cookies = new Map<string, string>();
	const event = {
		request: new Request(url, { method: 'POST', body: form }),
		url: new URL(url),
		cookies: {
			get: (n: string) => cookies.get(n),
			set: (n: string, v: string) => cookies.set(n, v),
			delete: (n: string) => cookies.delete(n)
		},
		getClientAddress: () => ip,
		locals: { log: silentLog }
	};

	try {
		const result = (await actions.default(event as never)) as {
			status: number;
			data: { error?: string };
		};
		return { status: result.status, error: result.data.error, cookies };
	} catch (thrown) {
		const { status, location } = thrown as { status: number; location?: string };
		if (!location) throw thrown;
		return { status, location, cookies };
	}
}

describe('/login password action', () => {
	it('signs in: sets the session cookie and lands on the library', async () => {
		const { email, ip } = await setup();

		const res = await signIn(ip, { email, password: PASSWORD });

		expect(res).toMatchObject({ status: 303, location: '/library' });
		expect(res.cookies.get('admin_session')).toBeTruthy();
	});

	it('rejects a wrong password with 401 and no cookie', async () => {
		const { email, ip } = await setup();

		const res = await signIn(ip, { email, password: 'wrong-password' });

		expect(res.status).toBe(401);
		expect(res.error).toMatch(/invalid credentials/i);
		expect(res.cookies.size).toBe(0);
	});

	it('refuses with 429 after repeated failures, even the right password', async () => {
		const { email, ip } = await setup();
		for (let i = 0; i < ADDRESS_CAP; i++) {
			expect((await signIn(ip, { email, password: 'wrong-password' })).status).toBe(401);
		}

		const res = await signIn(ip, { email, password: PASSWORD });

		expect(res.status).toBe(429);
		expect(res.error).toMatch(/too many failed attempts/i);
		expect(res.cookies.size).toBe(0);
	});

	it('forgives earlier failures once the caller signs in', async () => {
		const { email, ip } = await setup();
		for (let i = 0; i < ADDRESS_CAP - 1; i++) {
			await signIn(ip, { email, password: 'wrong-password' });
		}
		expect((await signIn(ip, { email, password: PASSWORD })).status).toBe(303);

		for (let i = 0; i < ADDRESS_CAP - 1; i++) {
			expect((await signIn(ip, { email, password: 'wrong-password' })).status).toBe(401);
		}
	});
});

describe('/login redirect after sign-in', () => {
	it("follows the form's same-origin redirectTo", async () => {
		const { email, ip } = await setup();

		const res = await signIn(ip, { email, password: PASSWORD, redirectTo: '/projects?tab=2' });

		expect(res.location).toBe('/projects?tab=2');
	});

	it('falls back to the query string when the form names none', async () => {
		const { email, ip } = await setup();

		const res = await signIn(
			ip,
			{ email, password: PASSWORD },
			'http://test.local/login?redirectTo=%2Fadmin'
		);

		expect(res.location).toBe('/admin');
	});

	it.each(['https://evil.test/', '//evil.test', '/\\evil.test'])(
		'ignores an off-origin target (%s)',
		async (target) => {
			const { email, ip } = await setup();

			const res = await signIn(
				ip,
				{ email, password: PASSWORD, redirectTo: target },
				`http://test.local/login?redirectTo=${encodeURIComponent(target)}`
			);

			expect(res.location).toBe('/library');
		}
	);
});
