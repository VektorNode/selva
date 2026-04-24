import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import { createSession } from '$lib/server/admin-auth.server';

// Redirect away if users already exist — setup is only for a fresh install
export const load: PageServerLoad = async () => {
	const page = await getAuthProvider().listUsers({ limit: 1 });
	if (page === null) {
		// Single-password mode — setup not applicable
		redirect(303, '/login');
	}
	if (page.items.length > 0) {
		redirect(303, '/login');
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
			const passwordAuth = getAuthProvider().passwordAuth;
			if (!passwordAuth) {
				return fail(501, { error: 'Password-based setup is not supported by this provider' });
			}
			const user = await passwordAuth.createUserWithPassword(email, password, [
				'platform_admin',
				'manage_users',
				'manage_compute',
				'manage_definitions',
				'manage_projects'
			]);
			await createSession(cookies, user);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return fail(500, { error: msg });
		}

		redirect(303, '/admin');
	}
} satisfies Actions;
