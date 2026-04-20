import type { PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import { assertManageUsers } from '$lib/server/access.server';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageUsers(locals);
	const auth = getAuthProvider();
	try {
		const page = await auth.listUsers({ limit: 200 });
		return { users: page?.items ?? null, capabilities: auth.capabilities };
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		return { users: null, capabilities: auth.capabilities };
	}
};
