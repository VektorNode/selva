import type { PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';

export const load: PageServerLoad = async () => {
	const users = await getAuthProvider().listUsers();
	return { users };
};
