import { error, isHttpError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type {
	AuthUser,
	OrgMember,
	OrgPermission,
	OrgRole,
	PlatformPermission
} from '@selvajs/platform';
import { ProviderError } from '@selvajs/platform';
import { getAuthProvider } from '$lib/server/providers.server';
import { listAllOrgMembers } from '$lib/server/org-members.server';
import {
	getLogger,
	getOrganizationProvider,
	getPermissionStore,
	getUserProfileStore
} from '$lib/server/providers.server';
import { assertManageInstanceUsers } from '$lib/server/access.server';

/**
 * `orgRole` and `orgPermissions` are the acting org's membership, shown here
 * read-only for context — this page edits platform scope only. Editing them
 * belongs to /team/members, which gates on `manage_org_members`.
 *
 * `displayName` lives on `UserProfile`, not `AuthUser`. Profiles are
 * batch-loaded and merged into the row so the UI keeps one row per user.
 */
export interface UserRow extends AuthUser {
	displayName?: string;
	platformPermissions: PlatformPermission[];
	orgRole?: OrgRole;
	orgPermissions: OrgPermission[];
}

export const load: PageServerLoad = async ({ locals }) => {
	assertManageInstanceUsers(locals);
	const ctx = locals.ctx!;
	const auth = getAuthProvider();
	// Admins never set another user's password, so the only direct-create path is
	// the passwordless allowlist.
	//
	// `createUser` says the provider CAN allowlist, not that it SHOULD. A
	// credential-owning provider (Supabase, local) admits users by invite — the
	// invitee sets their own password — and offering both paths there is two
	// buttons for one job. Worse on Supabase: allowlisting mints a confirmed
	// row with no password, so unless magic-link or OAuth is configured the
	// user it creates cannot sign in at all. Invite is the honest single path.
	const userCreation: 'email-only' | 'none' =
		auth.createUser && !auth.passwordAuth ? 'email-only' : 'none';
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
					orgPermissions
				};
			});
		}
	} catch (err) {
		// `users: null` means "this provider exposes no user store" — the page
		// renders wiring advice for it. Anything thrown here is a different thing
		// entirely, so it gets logged rather than rendered as that same message:
		// this block spans four provider calls, and swallowing all of them silently
		// turned every outage into "configure DATA_PATH".
		//
		// A denial still propagates. `ProviderError` carries `statusCode`, not
		// `status` — checking the wrong field is what made a 403 from
		// `getForBatch` render as an unavailable store on Supabase.
		if (isHttpError(err)) throw err;
		if (err instanceof ProviderError) error(err.statusCode, err.message);
		getLogger().error('Failed to load the admin user list', {
			actorId: ctx.userId,
			error: err instanceof Error ? err.message : String(err)
		});
	}

	const isPlatformAdmin = ctx.platformPermissions.includes('instance_admin');

	// The §2 sole-admin lock must not be derived from `users`: that list is a
	// 200-row page, so on a larger instance a second admin can sit past the cut
	// and the UI would lock a row the server would happily let go. Counting
	// admins other than nobody is the whole enabled-admin count, which the store
	// answers over every row.
	let enabledInstanceAdminCount: number | null = null;
	if (users) {
		try {
			enabledInstanceAdminCount = await getPermissionStore().countInstanceAdminsExcluding(ctx, '');
		} catch (err) {
			// A null count means "unknown" and the UI falls back to not locking —
			// the server refuses the removal either way, so a failed count must not
			// become a lock the operator cannot explain.
			getLogger().warn('Failed to count instance admins for the admin user list', {
				actorId: ctx.userId,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return { users, provider: providerInfo, isPlatformAdmin, enabledInstanceAdminCount };
};
