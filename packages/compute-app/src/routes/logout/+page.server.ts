import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { destroySession } from '$lib/server/admin-auth.server';
import { getAuthProvider } from '$lib/server/auth.server';

export const actions = {
	default: async ({ cookies }) => {
		destroySession(cookies);
		// Forward-auth/OIDC providers point us at the upstream IdP's sign-out
		// URL so the user actually leaves; credential providers return null.
		const target = getAuthProvider().getPostLogoutRedirect?.() ?? '/login';
		throw redirect(303, target);
	}
} satisfies Actions;
