import type { PageServerLoad } from './$types';
import type {
	AuthUser,
	Invite,
	OrgMember,
	OrgPermission,
	OrgRole,
	PlatformPermission
} from '@selvajs/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import { listAllOrgMembers } from '$lib/server/org-members.server';
import {
	getInviteStore,
	getOrganizationProvider,
	getPermissionStore,
	getUserProfileStore
} from '$lib/server/providers.server';
import { assertManageInstanceUsers } from '$lib/server/access.server';
import { flattenPermissions } from '$lib/server/permissions-compat.server';

/**
 * The admin users UI renders permissions as one flat list today; scoped views
 * come later. Each user's `platformPermissions` + default-org permissions are
 * merged into a single `permissions` array on the returned UserRow.
 *
 * `displayName` lives on `UserProfile`, not `AuthUser`. Profiles are
 * batch-loaded and merged into the row so the UI keeps one row per user.
 */
export interface UserRow extends AuthUser {
	displayName?: string;
	platformPermissions: PlatformPermission[];
	orgRole?: OrgRole;
	orgPermissions: OrgPermission[];
	permissions: Array<PlatformPermission | OrgPermission>;
}

export const load: PageServerLoad = async ({ locals }) => {
	assertManageInstanceUsers(locals);
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
			const userIds = page.items.map((u) => u.id);
			const profiles = await getUserProfileStore().getProfiles(ctx, userIds);
			const profileById = new Map(profiles.map((p) => [p.userId, p]));
			const platformByUser = await getPermissionStore().getForBatch(ctx, userIds);
			const activeOrgId = ctx.actingOrgId;
			// One membership listing instead of a getOrgMember round-trip per user —
			// the per-user lookup N+1s against remote adapters and re-runs on every
			// invalidation of this page.
			let memberByUserId = new Map<string, OrgMember>();
			if (activeOrgId) {
				const members = await listAllOrgMembers(orgs, activeOrgId);
				memberByUserId = new Map(members.map((m) => [m.userId, m]));
			}
			users = page.items.map((u) => {
				const member = memberByUserId.get(u.id);
				const orgPermissions: OrgPermission[] = member ? [...member.permissions] : [];
				const orgRole: OrgRole | undefined = member?.role;
				const profile = profileById.get(u.id);
				const platformPermissions = platformByUser.get(u.id) ?? [];
				// Header-auth carries the IdP display name on the identity's
				// metadata; the profile store only has a value once the user
				// sets one themselves.
				const metadataDisplayName =
					typeof u.metadata?.displayName === 'string' ? u.metadata.displayName : undefined;
				return {
					...u,
					displayName: profile?.displayName ?? metadataDisplayName,
					platformPermissions,
					orgRole,
					orgPermissions,
					permissions: flattenPermissions(platformPermissions, orgPermissions)
				};
			});
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
	}

	// Pending + recently-accepted invites for the active org. Non-fatal if
	// no active org yet (e.g. multi-tenant user not in any org).
	let invites: Invite[] = [];
	if (ctx.actingOrgId) {
		try {
			const page = await getInviteStore().listByOrg(ctx, ctx.actingOrgId, { limit: 100 });
			invites = page.items;
		} catch {
			// Non-fatal — users page still renders without invite list
		}
	}

	const isPlatformAdmin = ctx.platformPermissions.includes('instance_admin');
	return { users, provider: providerInfo, invites, isPlatformAdmin };
};
