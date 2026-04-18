import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import { createSession } from '$lib/server/admin-auth.server';

// Redirect away if users already exist — setup is only for a fresh install
export const load: PageServerLoad = async () => {
	const users = await getAuthProvider().listUsers();
	if (users === null) {
		// Single-password mode — setup not applicable
		redirect(303, '/admin/login');
	}
	if (users.length > 0) {
		redirect(303, '/admin/login');
	}
	return {};
};

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const email = data.get('email') as string | null;
		const password = data.get('password') as string | null;
		const confirm = data.get('confirm') as string | null;

		if (!email || !email.includes('@')) {
			return fail(400, { error: 'Valid email is required' });
		}
		if (!password || password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match' });
		}

		try {
			const auth = getAuthProvider();
			const user = await auth.createUser(email, password, 'platform_admin');
			if (!user) return fail(500, { error: 'Failed to create user' });
			await createSession(cookies, user);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return fail(500, { error: msg });
		}

		redirect(303, '/admin');
	}
} satisfies Actions;
