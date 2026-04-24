import type { PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import { assertManageUsers } from '$lib/server/access.server';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageUsers(locals);
	const auth = getAuthProvider();
	const userCreation: 'email-password' | 'email-only' | 'none' = auth.passwordAuth
		? 'email-password'
		: auth.createUser
			? 'email-only'
			: 'none';
	const providerInfo = { name: auth.name, userCreation };
	try {
		const page = await auth.listUsers({ limit: 200 });
		return { users: page?.items ?? null, provider: providerInfo };
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		return { users: null, provider: providerInfo };
	}
};
