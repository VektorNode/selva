import type { PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import { assertManageUsers } from '$lib/server/access.server';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageUsers(locals);
	const page = await getAuthProvider().listUsers({ limit: 200 });
	return { users: page?.items ?? null };
};
