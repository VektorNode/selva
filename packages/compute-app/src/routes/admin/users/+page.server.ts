import type { PageServerLoad } from './$types';
import type { AuthUser, Invite, OrgPermission, PlatformPermission } from '@selva/platform';
import { SYSTEM_CONTEXT } from '@selva/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import {
	getInviteStore,
	getOrganizationProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { assertManageUsers } from '$lib/server/access.server';
import { flattenPermissions } from '$lib/server/permissions-compat.server';

/**
 * §1g-core compat: the admin users UI still renders permissions as one flat list.
 * We merge each user's `platformPermissions` with their default-org permissions
 * into a `permissions` array on the returned UserRow so the existing UI keeps
 * working. §1g-ui replaces this with scoped views.
 *
 * §1e: `displayName` now lives on `UserProfile`, not `AuthUser`. We batch-load
 * profiles and merge into the row so the UI keeps its one-row-per-user shape.
 */
export interface UserRow extends AuthUser {
	displayName?: string;
	orgPermissions: OrgPermission[];
	permissions: Array<PlatformPermission | OrgPermission>;
}

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

	let users: UserRow[] | null = null;
	try {
		const page = await auth.listUsers({ limit: 200 });
		if (page) {
			const orgs = getOrganizationProvider();
			const profiles = await getUserProfileStore().getProfiles(page.items.map((u) => u.id));
			const profileById = new Map(profiles.map((p) => [p.userId, p]));
			const activeOrgId = ctx.orgId;
			users = await Promise.all(
				page.items.map(async (u) => {
					let orgPermissions: OrgPermission[] = [];
					if (activeOrgId) {
						const member = await orgs.getOrgMember(SYSTEM_CONTEXT, activeOrgId, u.id);
						orgPermissions = member?.permissions ?? [];
					}
					const profile = profileById.get(u.id);
					return {
						...u,
						displayName: profile?.displayName,
						orgPermissions,
						permissions: flattenPermissions(u.platformPermissions, orgPermissions)
					};
				})
			);
		}
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
