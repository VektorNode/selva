import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import {
	getEventSink,
	getOrganizationProvider,
	getPermissionStore
} from '$lib/server/providers.server';
import {
	assertCanGrantPlatformPermissions,
	requireManageInstanceUsers
} from '$lib/server/access.server';
import { listAllOrgMembers } from '$lib/server/org-members.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, created, parseBody } from '$lib/server/api/http';
import {
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	actorFrom,
	type OrgMember
} from '@selvajs/platform';
// `password` is deliberately absent: an admin never sets another user's
// credential. A stale client may still send one — Zod strips unknown keys, so it
// is dropped rather than rejected.
//
// Platform scope only — a new user joins the active org as a bare `member`, and
// their org permissions are granted at /team/members under manage_org_members.
const CreateUserBody = z.object({
	email: z.string().email('Valid email is required'),
	permissions: z.array(PlatformPermissionSchema)
});

// GET — list all users with their platform permissions and acting-org membership.
export const GET: RequestHandler = apiRoute('Failed to list users', async ({ locals }) => {
	requireManageInstanceUsers(locals);
	const page = await getAuthProvider().listUsers({ limit: 200 });
	if (page === null) {
		apiError(
			501,
			ApiErrorCode.INTERNAL,
			'User management is not supported by the current auth provider. Configure DATA_PATH (local provider) or check your provider wiring.'
		);
	}

	const orgId = locals.ctx?.actingOrgId;
	const orgs = getOrganizationProvider();
	// Single batch read for platform permissions instead of N round-trips.
	const userIds = page.items.map((u) => u.id);
	const platformByUser = await getPermissionStore().getForBatch(locals.ctx!, userIds);
	// One membership listing instead of a getOrgMember round-trip per user.
	const memberByUserId = new Map<string, OrgMember>();
	if (orgId) {
		for (const m of await listAllOrgMembers(orgs, orgId)) memberByUserId.set(m.userId, m);
	}
	const users = page.items.map((u) => {
		const member = memberByUserId.get(u.id);
		return {
			...u,
			platformPermissions: platformByUser.get(u.id) ?? [],
			orgRole: member?.role,
			orgPermissions: member ? [...member.permissions] : []
		};
	});
	return json({ users });
});

// POST — create a user + attach to default org with split permissions.
export const POST: RequestHandler = apiRoute(
	'Failed to create user',
	async ({ request, locals }) => {
		requireManageInstanceUsers(locals);
		const auth = getAuthProvider();

		const { email, permissions: platform } = await parseBody(request, CreateUserBody);

		assertCanGrantPlatformPermissions(locals.ctx!, platform);

		let user;
		if (auth.createUser) {
			// No password branch: a provider that owns credentials admits users by
			// invite, so nobody but the account holder ever chooses the password.
			// `createUser` is the allowlist path — under header-auth it is the only
			// way in, since the IdP holds the credential and Selva never sees one.
			user = await auth.createUser(email);
		} else {
			apiError(
				501,
				ApiErrorCode.INTERNAL,
				`${auth.name} cannot create a user directly. Send an invite instead — the recipient sets their own password.`
			);
		}

		await getEventSink().emit({
			type: 'user.created',
			userId: user.id,
			actorId: actorFrom(locals.ctx!)
		});

		// Grant platform permissions out-of-band via the data-layer store.
		if (platform.length > 0) {
			await setUserPlatformPermissions(locals.ctx!, user.id, platform);
		}

		// Attach to the active org as a bare member. Under header-auth this is the
		// only way in — the IdP holds the credential, so there is no invite to
		// accept. Org permissions are granted separately at /team/members.
		const orgId = locals.ctx?.actingOrgId;
		if (orgId) {
			const joinedAt = new Date().toISOString();
			await getOrganizationProvider().addOrgMember(SYSTEM_CONTEXT, {
				orgId,
				userId: user.id,
				role: 'member',
				permissions: [],
				joinedAt,
				updatedAt: joinedAt,
				updatedBy: locals.user?.id ?? user.id,
				deletedAt: null
			});
		}

		return created(user);
	}
);
