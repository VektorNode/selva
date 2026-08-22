import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import {
	setSessionCookie,
	checkRateLimit,
	recordFailedAttempt,
	clearRateLimit,
	warnIfAddressKeysCollapse,
	safeRedirectTarget
} from '$lib/server/admin-auth.server';
import { getAuthProvider } from '$lib/server/providers.server';
import { getPermissionStore } from '$lib/server/providers.server';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

/**
 * Surface the auth capabilities the page should render. We ask the auth port
 * what's available — never the env or a specific provider's name. An adapter
 * that doesn't broker OAuth omits `oauth`; an adapter that does decides for
 * itself which providers to expose via `listProviders()`.
 *
 * If the user is already authenticated (cookie session OR forward-auth headers
 * resolved in `hooks.server.ts`) we bounce them to their destination instead
 * of rendering the page. Without this, forward-auth users who land on /login
 * directly see a confusing "your proxy didn't forward the headers" message
 * even though auth is working — because the no-method/proxy-auth fallback
 * block doesn't know about the already-authed `locals.user`.
 */
export const load: PageServerLoad = async ({ locals, url, request }) => {
	if (locals.user) {
		const destination = safeRedirectTarget(url.searchParams.get('redirectTo'), '/library');
		redirect(303, destination);
	}

	// Mirrors `/setup`'s redirect to here once an admin exists: exactly one of
	// the two pages is live at a time. `/login` is a public route, so the
	// first-run redirect in hooks.server.ts skips it — without this, a fresh
	// deployment renders a working-looking form where every credential fails,
	// and the only way forward is guessing the /setup URL.
	//
	// Keyed on admin existence, not user count, for the same reason /setup is:
	// an OIDC provider that can't enumerate users still answers this.
	if (!(await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT))) {
		redirect(303, '/setup');
	}

	const auth = getAuthProvider();

	// Under forward-auth, landing here means identification failed in
	// hooks.server.ts. Two very different causes, and the operator-facing copy
	// must not conflate them: either the proxy forwarded none of the identity
	// headers (genuine wiring problem), or the headers arrived but the user
	// isn't on the allowlist (auth worked, access just isn't granted).
	const proxyHeadersMissing = auth.proxyAuth
		? auth.proxyAuth.hasNoIdentityHeaders(request.headers)
		: false;

	// While forward-auth deployments are still being wired, surface the
	// incoming request headers on the page so operators can confirm what the
	// proxy actually forwards without server-log access. Only populated under
	// proxy-auth (the only place it's useful), and value-redacted for headers
	// that carry secrets so /login doesn't leak cookies/tokens to a viewer.
	const REDACTED = new Set(['cookie', 'authorization', 'proxy-authorization']);
	const requestHeaders = auth.proxyAuth
		? [...request.headers]
				.map(([name, value]) => ({ name, value: REDACTED.has(name) ? '<redacted>' : value }))
				.sort((a, b) => a.name.localeCompare(b.name))
		: null;

	return {
		hasPasswordAuth: Boolean(auth.passwordAuth),
		hasEmailLink: Boolean(auth.emailLink),
		hasProxyAuth: Boolean(auth.proxyAuth),
		proxyHeadersMissing,
		requestHeaders,
		oauthProviders: auth.oauth?.listProviders() ?? []
	};
};

export const actions = {
	default: async (event: RequestEvent) => {
		const { request, cookies, url } = event;
		const ip = event.getClientAddress();

		// A POST can arrive without the load ever running (a stale form, a direct
		// post). On an uninitialized instance every credential fails, so without
		// this the attempt burns a rate-limit slot and answers "Invalid
		// credentials" — blaming the operator for a password that doesn't exist yet.
		if (!(await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT))) {
			redirect(303, '/setup');
		}

		const data = await request.formData();
		// Email is optional — when users.json is not configured only password is needed
		const email = (data.get('email') as string | null) ?? '';
		const password = data.get('password');
		const redirectTo = data.get('redirectTo');
		// Each failed round-trip bumps this so the page can tell a fresh rejection
		// from the one still on screen. Without it, a second wrong password renders
		// an identical page and reads as "nothing happened".
		const attempt = Number(data.get('attempt') ?? 0) + 1;

		// After the body is read, because the account bucket needs the email.
		warnIfAddressKeysCollapse(ip, event.locals.log);
		const { allowed } = checkRateLimit(ip, email);
		if (!allowed) {
			return fail(429, {
				email,
				attempt,
				error: 'Too many failed attempts. Try again in 15 minutes.'
			});
		}

		if (!password || typeof password !== 'string') {
			return fail(400, { email, attempt, error: 'Password is required' });
		}

		const passwordAuth = getAuthProvider().passwordAuth;
		if (!passwordAuth) {
			return fail(501, {
				email,
				attempt,
				error: 'Password login is not supported by this provider'
			});
		}

		const result = await passwordAuth.verifyLogin(email, password);

		switch (result.kind) {
			case 'failed':
				recordFailedAttempt(ip, email);
				return fail(401, { email, attempt, error: 'Invalid credentials' });
			case 'success': {
				clearRateLimit(ip, email);
				setSessionCookie(cookies, result.sessionToken);

				// Same-origin only. Form value wins; query-string is the fallback.
				const fromForm = typeof redirectTo === 'string' ? redirectTo : null;
				const fromQuery = url.searchParams.get('redirectTo');
				const destination =
					safeRedirectTarget(fromForm, '') || safeRedirectTarget(fromQuery, '/library');

				redirect(303, destination);
			}
		}
	}
} satisfies Actions;
