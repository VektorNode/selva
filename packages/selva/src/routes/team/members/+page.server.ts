import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { AuthUser, Invite, OrgMember, OrgRole } from '@selvajs/platform';
import { hasPermission } from '@selvajs/platform';
import { getAuthProvider } from '#lib/server/providers.server.js';
import {
	getInviteStore,
	getNotificationProvider,
	getOrganizationProvider,
	getUserProfileStore
} from '#lib/server/providers.server.js';

export interface MemberRow extends OrgMember {
	email?: string;
	displayName?: string;
	/**
	 * From the auth provider, not the membership row. Absent ⇒ the user was
	 * provisioned (allowlisted/added) but has never authenticated, so the
	 * membership's `joinedAt` is really a "provisioned at" timestamp. The UI
	 * shows "Invited" rather than "Joined" in that case.
	 */
	lastLoginAt?: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_org_members')) redirect(303, '/library');

	const orgId = ctx.actingOrgId;
	if (!orgId) {
		return {
			members: [] as MemberRow[],
			invites: [] as Invite[],
			orgId: null,
			mailConfigured: getNotificationProvider().isConfigured(),
			actorRole: null as OrgRole | null,
			actorUserId: ctx.userId
		};
	}

	const orgs = getOrganizationProvider();
	const auth = getAuthProvider();

	// The roster and the invites are independent, and each member's identity and profile
	// depend only on the roster: two waits, not four.
	const pendingInvites = getInviteStore()
		.listByOrg(ctx, orgId, { limit: 100 })
		.then((page) => page.items)
		.catch((): Invite[] => []);

	let members: MemberRow[] = [];
	let actorRole: OrgRole | null = null;
	try {
		const page = await orgs.listOrgMembers(ctx, orgId, { limit: 200 });
		const userIds = page.items.map((m) => m.userId);
		// `displayName` lives on `UserProfile`, not `AuthUser`, and the profile only
		// has a value once the user sets one. Header-auth carries the IdP name on
		// the identity's metadata instead — same resolution order as /admin/users,
		// so one person renders identically on both pages.
		const [users, profiles] = await Promise.all([
			Promise.all(userIds.map((id) => auth.getUser(id).catch(() => null as AuthUser | null))),
			getUserProfileStore().getProfiles(ctx, userIds)
		]);
		const userById = new Map(users.filter((u): u is AuthUser => !!u).map((u) => [u.id, u]));
		const profileById = new Map(profiles.map((p) => [p.userId, p]));
		members = page.items.map((m) => {
			const authUser = userById.get(m.userId);
			const metadataDisplayName =
				typeof authUser?.metadata?.displayName === 'string'
					? authUser.metadata.displayName
					: undefined;
			return {
				...m,
				email: authUser?.email,
				displayName: profileById.get(m.userId)?.displayName ?? metadataDisplayName,
				lastLoginAt: authUser?.lastLoginAt
			};
		});
		actorRole = page.items.find((m) => m.userId === ctx.userId)?.role ?? null;
	} catch {
		// Provider may not support listing — surface empty roster
	}

	const invites = await pendingInvites;

	// Drives the copy after minting: with mail off the admin must send the link
	// themselves, so the UI says so instead of implying it was delivered.
	return {
		members,
		invites,
		orgId,
		actorRole,
		actorUserId: ctx.userId,
		mailConfigured: getNotificationProvider().isConfigured()
	};
};
