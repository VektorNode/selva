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

/**
 * Surface the auth capabilities the page should render. We ask the auth port
 * what's available — never the env or a specific provider's name. An adapter
 * that doesn't broker OAuth omits `oauth`; an adapter that does decides for
 * itself which providers to expose via `listProviders()`.
 */
export const load: PageServerLoad = async () => {
	const auth = getAuthProvider();
	return {
		hasPasswordAuth: Boolean(auth.passwordAuth),
		hasEmailLink: Boolean(auth.emailLink),
		oauthProviders: auth.oauth?.listProviders() ?? []
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
