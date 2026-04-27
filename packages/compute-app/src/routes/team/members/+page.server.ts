import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { AuthUser, Invite, OrgMember } from '@selvajs/platform';
import { hasPermission } from '@selvajs/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import { getInviteStore, getOrganizationProvider } from '$lib/server/providers.server';

export interface MemberRow extends OrgMember {
	email?: string;
	displayName?: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_org_members')) redirect(303, '/library');

	const orgId = ctx.actingOrgId;
	if (!orgId) {
		return { members: [] as MemberRow[], invites: [] as Invite[], orgId: null };
	}

	const orgs = getOrganizationProvider();
	const auth = getAuthProvider();

	let members: MemberRow[] = [];
	try {
		const page = await orgs.listOrgMembers(ctx, orgId, { limit: 200 });
		const userIds = page.items.map((m) => m.userId);
		const users = await Promise.all(
			userIds.map((id) =>
				auth.getUser(id).catch(() => null as AuthUser | null)
			)
		);
		const userById = new Map(users.filter((u): u is AuthUser => !!u).map((u) => [u.id, u]));
		members = page.items.map((m) => ({
			...m,
			email: userById.get(m.userId)?.email
		}));
	} catch {
		// Provider may not support listing — surface empty roster
	}

	let invites: Invite[] = [];
	try {
		const page = await getInviteStore().listByOrg(ctx, orgId, { limit: 100 });
		invites = page.items;
	} catch {
		// Non-fatal
	}

	return { members, invites, orgId };
};
