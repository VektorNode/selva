import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider, getPermissionStore } from '$lib/server/providers.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';
import { throwZodError } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	DEFAULT_ORG_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	type PlatformPermission,
	hasPermission
} from '@selva/platform';
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
	if (!id) throw error(400, 'Missing user ID');

	const body = await request.json().catch(() => null);
	const parsed = UpdatePermissionsBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { platform, org } = splitFlatPermissions(parsed.data.permissions);

	// Granting or revoking platform-scope permissions requires the caller to
	// already hold instance_admin. Without this, any org admin with
	// manage_instance_users could self-elevate to instance_admin.
	const existingPlatform: PlatformPermission[] = await getPermissionStore().getFor(
		locals.ctx!,
		id
	);
	const platformChanged =
		platform.length !== existingPlatform.length ||
		platform.some((p: PlatformPermission) => !existingPlatform.includes(p)) ||
		existingPlatform.some((p: PlatformPermission) => !platform.includes(p));
	if (platformChanged && !hasPermission(locals.ctx!, 'instance_admin')) {
		throw error(403, 'Only a platform admin can change platform-scope permissions');
	}

	const platformResult = await setUserPlatformPermissions(locals.ctx!, id, platform);
	if (platformResult === 'not_found') throw error(404, 'User not found');
	if (platformResult === 'not_supported')
		throw error(501, 'Platform permission updates not supported by this auth provider');
	if (platformResult === 'last_admin')
		throw error(
			409,
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

	return json({ success: true });
};

// DELETE — remove user. The §2 sole-`instance_admin` invariant is enforced
// here, BEFORE the auth provider deletes, by consulting the permission store
// (the auth provider no longer owns Selva-specific authorization).
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageInstanceUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const targetPerms = await getPermissionStore().getFor(locals.ctx!, id);
	if (targetPerms.includes('instance_admin')) {
		const others = await getPermissionStore().countInstanceAdminsExcluding(locals.ctx!, id);
		if (others === 0) {
			throw error(
				409,
				'Cannot delete the last instance admin. Promote another user to instance admin first.'
			);
		}
	}

	const result = await getAuthProvider().deleteUser(id);
	if (result === 'not_found') throw error(404, 'User not found');
	if (result === 'not_supported')
		throw error(501, 'User deletion not supported by this auth provider');

	return json({ success: true });
};
