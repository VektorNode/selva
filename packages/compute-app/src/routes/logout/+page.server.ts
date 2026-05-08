import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { destroySession } from '$lib/server/admin-auth.server';

export const actions = {
	default: async ({ cookies }) => {
		destroySession(cookies);
		throw redirect(303, '/login');
	}
} satisfies Actions;
