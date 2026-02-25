import { redirect, fail } from '@sveltejs/kit';
import type { Actions, RequestEvent } from './$types';
import {
	verifyPassword,
	createSession,
	checkRateLimit,
	recordFailedAttempt,
	clearRateLimit
} from '$lib/server/admin-auth.server';

export const actions = {
	default: async (event: RequestEvent) => {
		const { request, cookies } = event;
		const ip = event.getClientAddress();

		const { allowed } = checkRateLimit(ip);
		if (!allowed) {
			return fail(429, { error: 'Too many failed attempts. Try again in 15 minutes.' });
		}

		const data = await request.formData();
		const password = data.get('password');

		if (!password || typeof password !== 'string') {
			return fail(400, { error: 'Password is required' });
		}

		if (!verifyPassword(password)) {
			recordFailedAttempt(ip);
			return fail(401, { error: 'Invalid password' });
		}

		clearRateLimit(ip);
		createSession(cookies);
		redirect(303, '/admin');
	}
} satisfies Actions;
