import type { PageServerLoad } from './$types';
import type { AuthUser, Invite } from '@selva/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import {
	getInviteStore,
	getOrganizationProvider
} from '$lib/server/providers.server';
import { assertManageUsers } from '$lib/server/access.server';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageUsers(locals);
	const ctx = locals.ctx!;
	const auth = getAuthProvider();
	const userCreation: 'email-password' | 'email-only' | 'none' = auth.passwordAuth
		? 'email-password'
		: auth.createUser
			? 'email-only'
			: 'none';
	const providerInfo = { name: auth.name, userCreation };

	let users: AuthUser[] | null = null;
	try {
		const page = await auth.listUsers({ limit: 200 });
		users = page?.items ?? null;
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
	}

	// Pending + recently-accepted invites for the active org. Non-fatal if
	// no org is configured yet — setup flow will create one on first login.
	let invites: Invite[] = [];
	try {
		const orgsPage = await getOrganizationProvider().listOrgs(ctx, { limit: 1 });
		const org = orgsPage.items[0];
		if (org) {
			const page = await getInviteStore().listByOrg(ctx, org.id, { limit: 100 });
			invites = page.items;
		}
	} catch {
		// Non-fatal — users page still renders without invite list
	}

	return { users, provider: providerInfo, invites };
};
