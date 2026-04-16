import { redirect, fail } from '@sveltejs/kit';
import type { Actions, RequestEvent } from './$types';
import { createSession, checkRateLimit, recordFailedAttempt, clearRateLimit } from '$lib/server/admin-auth.server';
import { getAuthProvider } from '$lib/server/auth.server';

export const actions = {
	default: async (event: RequestEvent) => {
		const { request, cookies } = event;
		const ip = event.getClientAddress();

		const { allowed } = checkRateLimit(ip);
		if (!allowed) {
			return fail(429, { error: 'Too many failed attempts. Try again in 15 minutes.' });
		}

		const data = await request.formData();
		// Email is optional — when users.json is not configured only password is needed
		const email = (data.get('email') as string | null) ?? '';
		const password = data.get('password');

		if (!password || typeof password !== 'string') {
			return fail(400, { error: 'Password is required' });
		}

		const user = await getAuthProvider().verifyLoginCredentials(email, password);

		if (!user) {
			recordFailedAttempt(ip);
			return fail(401, { error: 'Invalid credentials' });
		}

		clearRateLimit(ip);
		await createSession(cookies, user);
		redirect(303, '/admin');
	}
} satisfies Actions;
