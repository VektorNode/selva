import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider, getPermissionStore } from '$lib/server/providers.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';
import { listAllOrgMembers } from '$lib/server/org-members.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	hasPermission,
	MEMBER_ASSIGNABLE_PERMISSIONS
} from '@selvajs/platform';
import { splitFlatPermissions, flattenPermissions } from '$lib/server/permissions-compat.server';

// Admin UI sends a flat permission list; we split into platform + default-org
// scopes server-side until the UI grows two dedicated surfaces.
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

// `password` is deliberately absent: an admin never sets another user's
// credential. A stale client may still send one — Zod strips unknown keys, so it
// is dropped rather than rejected.
const CreateUserBody = z.object({
	email: z.string().email('Valid email is required'),
	permissions: z.array(FlatPermissionSchema)
});

// GET — list all users with a flat "permissions" projection for the admin UI.
export const GET: RequestHandler = async ({ locals }) => {
	requireManageInstanceUsers(locals);
	const page = await getAuthProvider().listUsers({ limit: 200 });
	if (page === null) {
		apiError(
			501,
			ApiErrorCode.INTERNAL,
			'User management is not supported by the current auth provider. Configure DATA_PATH (local provider) or check your provider wiring.'
		);
	}

	// Merge each user's platform perms with their default-org perms so the
	// current admin UI sees the familiar flat list. Default org = ctx.actingOrgId.
	const orgId = locals.ctx?.actingOrgId;
	const orgs = getOrganizationProvider();
	// Single batch read for platform permissions instead of N round-trips.
	const userIds = page.items.map((u) => u.id);
	const platformByUser = await getPermissionStore().getForBatch(locals.ctx!, userIds);
	// One membership listing instead of a getOrgMember round-trip per user.
	const memberByUserId = new Map<string, { permissions: readonly string[] }>();
	if (orgId) {
		for (const m of await listAllOrgMembers(orgs, orgId)) memberByUserId.set(m.userId, m);
	}
	const flattened = page.items.map((u) => {
		const orgPerms = memberByUserId.get(u.id)?.permissions ?? [];
		const platformPerms = platformByUser.get(u.id) ?? [];
		return {
			...u,
			platformPermissions: platformPerms,
			permissions: flattenPermissions(
				platformPerms,
				orgPerms as Parameters<typeof flattenPermissions>[1]
			)
		};
	});
	return json({ users: flattened });
};

// POST — create a user + attach to default org with split permissions.
export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageInstanceUsers(locals);
	const auth = getAuthProvider();

	const body = await request.json().catch(() => null);
	const parsed = CreateUserBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { email, permissions } = parsed.data;
	const { platform, org } = splitFlatPermissions(permissions);

	// Only an existing platform admin may create a user with platform-scope perms.
	if (platform.length > 0 && !hasPermission(locals.ctx!, 'instance_admin')) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Only a platform admin can grant platform-scope permissions'
		);
	}

	try {
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

		// Grant platform permissions out-of-band via the data-layer store.
		if (platform.length > 0) {
			await setUserPlatformPermissions(locals.ctx!, user.id, platform);
		}

		// Attach to the active org as a member. Members can only hold the
		// non-governance permissions (manage_definitions, manage_projects) —
		// drop anything else silently so the UI can send whatever.
		const orgId = locals.ctx?.actingOrgId;
		if (orgId) {
			const joinedAt = new Date().toISOString();
			await getOrganizationProvider().addOrgMember(SYSTEM_CONTEXT, {
				orgId,
				userId: user.id,
				role: 'member',
				permissions: org.filter((p) => MEMBER_ASSIGNABLE_PERMISSIONS.includes(p)),
				joinedAt,
				updatedAt: joinedAt,
				updatedBy: locals.user?.id ?? user.id,
				deletedAt: null
			});
		}

		return json(user, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create user');
	}
};
