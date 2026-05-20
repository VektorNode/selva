import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import {
	setSessionCookie,
	checkRateLimit,
	recordFailedAttempt,
	clearRateLimit,
	safeRedirectTarget
} from '$lib/server/admin-auth.server';
import { getAuthProvider } from '$lib/server/auth.server';

// DEBUG (temporary, remove after deployment stabilizes): produce a sorted
// snapshot of every incoming header so we can surface it on /login for
// operators diagnosing forward-auth header mismatches.
function snapshotRequestHeaders(headers: Headers): Array<{ name: string; value: string }> {
	const out: Array<{ name: string; value: string }> = [];
	headers.forEach((value, name) => out.push({ name, value }));
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

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

	const auth = getAuthProvider();
	const hasProxyAuth = Boolean(auth.proxyAuth);

	// DEBUG (temporary, remove after deployment stabilizes): when forward-auth
	// is the configured auth method and the user landed on /login (meaning
	// header identification failed in hooks.server.ts), capture every header
	// on the request so the page can render them. Avoids the SSH-to-the-box
	// roundtrip for operators verifying their proxy config.
	const debugHeaders = hasProxyAuth ? snapshotRequestHeaders(request.headers) : null;

	return {
		hasPasswordAuth: Boolean(auth.passwordAuth),
		hasEmailLink: Boolean(auth.emailLink),
		hasProxyAuth,
		oauthProviders: auth.oauth?.listProviders() ?? [],
		debugHeaders
	};
};

export const actions = {
	default: async (event: RequestEvent) => {
		const { request, cookies, url } = event;
		const ip = event.getClientAddress();

		const { allowed } = checkRateLimit(ip);
		if (!allowed) {
			return fail(429, { error: 'Too many failed attempts. Try again in 15 minutes.' });
		}

		const data = await request.formData();
		// Email is optional — when users.json is not configured only password is needed
		const email = (data.get('email') as string | null) ?? '';
		const password = data.get('password');
		const redirectTo = data.get('redirectTo');

		if (!password || typeof password !== 'string') {
			return fail(400, { error: 'Password is required' });
		}

		const passwordAuth = getAuthProvider().passwordAuth;
		if (!passwordAuth) {
			return fail(501, { error: 'Password login is not supported by this provider' });
		}

		const result = await passwordAuth.verifyLogin(email, password);

		switch (result.kind) {
			case 'failed':
				recordFailedAttempt(ip);
				return fail(401, { error: 'Invalid credentials' });
			case 'success': {
				clearRateLimit(ip);
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
