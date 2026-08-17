/**
 * Finding 7 — logout must revoke the session provider-side, not just drop the
 * cookie.
 *
 * Deleting the cookie stops this browser from sending the token; it does
 * nothing to the token itself. On Supabase the access token stays valid at
 * GoTrue and the refresh token lives 30 days, so anyone who captured either
 * keeps a working session after the user believes they signed out.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	installSessionRefreshShim,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { actions } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** Minimal `Cookies` stand-in — logout only reads one and deletes two. */
function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	return {
		deleted: [] as string[],
		get(name: string) {
			return jar.get(name);
		},
		delete(this: { deleted: string[] }, name: string) {
			jar.delete(name);
			this.deleted.push(name);
		}
	};
}

async function runLogout(cookies: ReturnType<typeof fakeCookies>) {
	try {
		// The action always ends in a redirect, which SvelteKit throws.
		await actions.default({ cookies } as never);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) return err as { status: number };
		throw err;
	}
	throw new Error('logout did not redirect');
}

describe('finding 7 — logout revokes server-side', () => {
	it('revokes the session token before clearing cookies', async () => {
		tp = await freshProviders();
		const shim = installSessionRefreshShim(tp);
		const cookies = fakeCookies({ admin_session: 'live-token', admin_refresh: 'live-refresh' });

		const res = await runLogout(cookies);
		expect(res.status).toBe(303);

		expect(shim.revoked).toEqual(['live-token']);
		expect(cookies.deleted).toContain('admin_session');
		expect(cookies.deleted).toContain('admin_refresh');
	});

	it('still logs out when the provider cannot revoke', async () => {
		tp = await freshProviders();
		// The local provider exposes no `sessionRefresh` at all — the optional-chain
		// must degrade to cookie deletion rather than throw.
		const cookies = fakeCookies({ admin_session: 'live-token' });

		const res = await runLogout(cookies);
		expect(res.status).toBe(303);
		expect(cookies.deleted).toContain('admin_session');
	});

	it('does not call revoke when there is no session cookie', async () => {
		tp = await freshProviders();
		const shim = installSessionRefreshShim(tp);
		const cookies = fakeCookies();

		await runLogout(cookies);
		expect(shim.revoked).toEqual([]);
	});
});
