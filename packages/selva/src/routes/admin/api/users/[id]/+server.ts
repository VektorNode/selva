import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import {
	getDataProvider,
	getOrganizationProvider,
	getPermissionStore
} from '$lib/server/providers.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';
import { throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	DEFAULT_ORG_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	type PlatformPermission,
	hasPermission
} from '@selvajs/platform';
import { splitFlatPermissions } from '$lib/server/permissions-compat.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';

const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const UpdatePermissionsBody = z.object({
	permissions: z.array(FlatPermissionSchema)
});

// Splits the flat list into platform + default-org permissions and writes both.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireManageInstanceUsers(locals);
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing user ID');

	const body = await request.json().catch(() => null);
	const parsed = UpdatePermissionsBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { platform, org } = splitFlatPermissions(parsed.data.permissions);

	// Granting or revoking platform-scope permissions requires the caller to
	// already hold instance_admin. Without this, any org admin with
	// manage_instance_users could self-elevate to instance_admin.
	const existingPlatform: PlatformPermission[] = await getPermissionStore().getFor(locals.ctx!, id);
	const platformChanged =
		platform.length !== existingPlatform.length ||
		platform.some((p: PlatformPermission) => !existingPlatform.includes(p)) ||
		existingPlatform.some((p: PlatformPermission) => !platform.includes(p));
	if (platformChanged && !hasPermission(locals.ctx!, 'instance_admin')) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Only a platform admin can change platform-scope permissions'
		);
	}

	const platformResult = await setUserPlatformPermissions(locals.ctx!, id, platform);
	if (platformResult === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
	if (platformResult === 'not_supported')
		apiError(
			501,
			ApiErrorCode.INTERNAL,
			'Platform permission updates not supported by this auth provider'
		);
	if (platformResult === 'last_admin')
		apiError(
			409,
			ApiErrorCode.CONFLICT,
			'Cannot remove the last instance admin. Promote another user to instance admin first.'
		);

	const orgId = locals.ctx?.actingOrgId;
	if (orgId) {
		const orgs = getOrganizationProvider();
		const existing = await orgs.getOrgMember(SYSTEM_CONTEXT, orgId, id);
		// owner/admin always hold all org permissions; members are capped to the
		// non-governance subset. The UI mirrors this — the server is the
		// safety net if anything bypasses the UI.
		const resolvedPermissions = (role: 'owner' | 'admin' | 'member') =>
			role === 'member'
				? org.filter((p) => MEMBER_ASSIGNABLE_PERMISSIONS.includes(p))
				: [...DEFAULT_ORG_PERMISSIONS[role]];
		if (existing) {
			await orgs.updateOrgMemberPermissions(
				SYSTEM_CONTEXT,
				orgId,
				id,
				resolvedPermissions(existing.role)
			);
		} else {
			// Promote to member with the requested org perms.
			const joinedAt = new Date().toISOString();
			await orgs.addOrgMember(SYSTEM_CONTEXT, {
				orgId,
				userId: id,
				role: 'member',
				permissions: resolvedPermissions('member'),
				joinedAt,
				updatedAt: joinedAt,
				updatedBy: locals.user?.id ?? id,
				deletedAt: null
			});
		}
	}

	return new Response(null, { status: 204 });
};

// DELETE — remove user. The §2 sole-`instance_admin` invariant is enforced
// here, BEFORE the auth provider deletes, by consulting the permission store
// (the auth provider no longer owns Selva-specific authorization).
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageInstanceUsers(locals);
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing user ID');

	const targetPerms = await getPermissionStore().getFor(locals.ctx!, id);
	if (targetPerms.includes('instance_admin')) {
		const others = await getPermissionStore().countInstanceAdminsExcluding(locals.ctx!, id);
		if (others === 0) {
			apiError(
				409,
				ApiErrorCode.CONFLICT,
				'Cannot delete the last instance admin. Promote another user to instance admin first.'
			);
		}
	}

	// Capture the email BEFORE deletion — `onUserDeleted` needs it to scrub
	// invite/audit rows keyed by email, but the auth user is gone by then.
	const target = await getAuthProvider().getUser(id);
	const email = target?.email;

	const result = await getAuthProvider().deleteUser(id);
	if (result === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
	if (result === 'not_supported')
		apiError(501, ApiErrorCode.INTERNAL, 'User deletion not supported by this auth provider');

	// Cascade + erasure: drop the user-data row and scrub personal data not
	// reachable by FK cascade (audit rows, invites-by-email, solve telemetry).
	// Supabase erases those explicitly; local removes its JSON rows + memberships.
	await getDataProvider().onUserDeleted(SYSTEM_CONTEXT, id, { email });

	return new Response(null, { status: 204 });
};
