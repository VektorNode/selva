// `/login` and `/setup` are meant to be mutually exclusive: exactly one is live
// depending on whether an instance admin exists. The `/setup` → `/login` half
// was implemented; this half was not.
//
// `/login` sits on the public-route allowlist, so the first-run redirect in
// hooks.server.ts skips it. A fresh deployment therefore rendered a working
// login form on which every credential fails, with no path to the bootstrap
// flow short of guessing the /setup URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const hasInstanceAdmin = vi.fn();

vi.mock('$lib/server/providers.server', () => ({
	getPermissionStore: () => ({ hasInstanceAdmin })
}));

vi.mock('$lib/server/auth.server', () => ({
	getAuthProvider: () => ({
		passwordAuth: { verifyLogin: vi.fn() },
		emailLink: undefined,
		proxyAuth: undefined,
		oauth: undefined
	})
}));

vi.mock('$lib/server/admin-auth.server', () => ({
	setSessionCookie: vi.fn(),
	checkRateLimit: vi.fn(() => ({ allowed: true })),
	recordFailedAttempt: vi.fn(),
	clearRateLimit: vi.fn(),
	safeRedirectTarget: (target: string | null, fallback: string) => target ?? fallback
}));

const { load, actions } = await import('../+page.server');

/** SvelteKit's `redirect()` throws; this pulls the status/location back out. */
async function captureRedirect(run: () => Promise<unknown>) {
	try {
		await run();
	} catch (thrown) {
		return thrown as { status: number; location: string };
	}
	return null;
}

const loadEvent = () =>
	({
		locals: {},
		url: new URL('https://example.dev/login'),
		request: new Request('https://example.dev/login', { headers: new Headers() })
	}) as never;

describe('/login on an uninitialized instance', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /setup when no instance admin exists', async () => {
		hasInstanceAdmin.mockResolvedValue(false);

		const redirected = await captureRedirect(() => load(loadEvent()));

		expect(redirected?.status).toBe(303);
		expect(redirected?.location).toBe('/setup');
	});

	it('renders the form once an admin exists', async () => {
		hasInstanceAdmin.mockResolvedValue(true);

		const result = (await load(loadEvent())) as { hasPasswordAuth: boolean };

		expect(result.hasPasswordAuth).toBe(true);
	});

	it('redirects a POST too, rather than failing the credentials', async () => {
		// A stale form or a direct post reaches the action without the load ever
		// running. Answering "Invalid credentials" there blames the operator for a
		// password that cannot exist yet, and spends a rate-limit slot doing it.
		hasInstanceAdmin.mockResolvedValue(false);
		const { checkRateLimit } = await import('$lib/server/admin-auth.server');

		const redirected = await captureRedirect(() =>
			actions.default({
				request: new Request('https://example.dev/login', { method: 'POST' }),
				cookies: {},
				url: new URL('https://example.dev/login'),
				getClientAddress: () => '203.0.113.1'
			} as never)
		);

		expect(redirected?.status).toBe(303);
		expect(redirected?.location).toBe('/setup');
		expect(checkRateLimit).not.toHaveBeenCalled();
	});
});
