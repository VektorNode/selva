import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';
import { throwZodError } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	DEFAULT_ORG_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	hasPermission
} from '@selva/platform';
import { splitFlatPermissions } from '$lib/server/permissions-compat.server';

const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const UpdatePermissionsBody = z.object({
	permissions: z.array(FlatPermissionSchema)
});

// PATCH — update permissions. Splits the flat list into platform + default-org
// permissions and writes both. §1g-ui will replace with scoped endpoints.
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
	const existingUser = await getAuthProvider().getUser(id);
	const existingPlatform = existingUser?.platformPermissions ?? [];
	const platformChanged =
		platform.length !== existingPlatform.length ||
		platform.some((p) => !existingPlatform.includes(p)) ||
		existingPlatform.some((p) => !platform.includes(p));
	if (platformChanged && !hasPermission(locals.ctx!, 'instance_admin')) {
		throw error(403, 'Only a platform admin can change platform-scope permissions');
	}

	const platformResult = await getAuthProvider().updateUserPlatformPermissions(id, platform);
	if (platformResult === 'not_found') throw error(404, 'User not found');
	if (platformResult === 'not_supported')
		throw error(501, 'Platform permission updates not supported by this auth provider');

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
			// In-place permission update. We cheat through the loader by re-adding
			// after removing — a clean updateOrgMemberPermissions will arrive in §1g-ui.
			await orgs.removeOrgMember(SYSTEM_CONTEXT, orgId, id);
			await orgs.addOrgMember(SYSTEM_CONTEXT, {
				...existing,
				permissions: resolvedPermissions(existing.role)
			});
		} else {
			// Promote to member with the requested org perms.
			await orgs.addOrgMember(SYSTEM_CONTEXT, {
				orgId,
				userId: id,
				role: 'member',
				permissions: resolvedPermissions('member'),
				joinedAt: new Date().toISOString()
			});
		}
	}

	return json({ success: true });
};

// DELETE — remove user
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageInstanceUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const ok = await getAuthProvider().deleteUser(id);
	if (!ok) throw error(404, 'User not found or operation not supported');

	return json({ success: true });
};
