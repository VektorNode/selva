import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { destroySession, getSessionToken } from '$lib/server/admin-auth.server';
import { getAuthProvider } from '$lib/server/providers.server';

export const actions = {
	default: async ({ cookies }) => {
		// Deleting the cookies only stops *this* browser from sending the tokens —
		// they stay valid at the auth provider, so anyone who captured one keeps a
		// working session, and the refresh token lives 30 days. Revoke server-side
		// first. Best-effort and never throws, so a provider outage still logs the
		// user out locally.
		const token = getSessionToken(cookies);
		if (token) await getAuthProvider().sessionRefresh?.revokeSession(token);

		destroySession(cookies);
		throw redirect(303, '/login');
	}
} satisfies Actions;
