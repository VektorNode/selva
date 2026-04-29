import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import {
	checkRateLimit,
	recordFailedAttempt,
	safeRedirectTarget
} from '$lib/server/admin-auth.server';

/**
 * POST /auth/email/start (form action)
 *
 * Capability-named entry point for passwordless email sign-in. The form
 * lives on `/login` (and optionally `/setup`); this action delegates to
 * whichever auth provider implements `IEmailLinkAuth` and 303s to
 * `/auth/email/sent` so the user knows to check their inbox.
 *
 * `redirectTo` is preserved through the round trip so the user lands on the
 * page they were trying to reach when the link is clicked.
 *
 * No GET handler — there's no UI here, only a form action target. Visiting
 * this URL directly redirects to /login.
 */
export const load: PageServerLoad = async () => {
	redirect(303, '/login');
};

export const actions = {
	default: async (event) => {
		const { request, url } = event;
		const ip = event.getClientAddress();

		// Same per-IP rate limit as the password-login form. The auth provider
		// also has its own rate limit (Supabase enforces server-side), but
		// stopping requests here saves outbound calls for known abuse.
		const { allowed } = checkRateLimit(ip);
		if (!allowed) {
			return fail(429, { error: 'Too many requests. Try again in 15 minutes.' });
		}

		const data = await request.formData();
		const email = (data.get('email') as string | null)?.trim().toLowerCase();
		const redirectTo = data.get('redirectTo');

		if (!email || !email.includes('@')) {
			return fail(400, { error: 'A valid email address is required.' });
		}

		const auth = getAuthProvider();
		if (!auth.emailLink) {
			return fail(501, { error: 'Email sign-in is not supported by this provider.' });
		}

		// Forward `redirectTo` through to the callback so the user lands on
		// their destination after clicking the link.
		const callbackUrl = new URL('/auth/email/callback', url.origin);
		const fromForm = typeof redirectTo === 'string' ? redirectTo : null;
		const fromQuery = url.searchParams.get('redirectTo');
		const safeDest = safeRedirectTarget(fromForm, '') || safeRedirectTarget(fromQuery, '');
		if (safeDest) callbackUrl.searchParams.set('redirectTo', safeDest);

		const result = await auth.emailLink.sendMagicLink(email, callbackUrl.toString());
		if (!result.ok) {
			// Don't burn rate-limit on the legitimate "signup disabled" case — that's
			// a configuration answer, not abuse. Log every other classified failure.
			if (result.reason !== 'signup_disabled') recordFailedAttempt(ip);
			return fail(400, { error: messageForReason(result.reason) });
		}

		// 303 to a confirmation page. Don't echo the email back in a query
		// param — opening a /sent page in another tab shouldn't leak the
		// address. The page is intentionally generic.
		redirect(303, '/auth/email/sent');
	}
} satisfies Actions;

function messageForReason(reason: 'rate_limited' | 'signup_disabled' | 'invalid_email'): string {
	switch (reason) {
		case 'rate_limited':
			return 'Too many emails sent. Try again in a few minutes.';
		case 'signup_disabled':
			return 'This email is not registered, and self-signup is disabled.';
		case 'invalid_email':
			return 'That email address looks invalid.';
	}
}
