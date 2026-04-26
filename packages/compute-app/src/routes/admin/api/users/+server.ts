import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider, getPermissionStore } from '$lib/server/providers.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	hasPermission,
	MEMBER_ASSIGNABLE_PERMISSIONS
} from '@selva/platform';
import { splitFlatPermissions, flattenPermissions } from '$lib/server/permissions-compat.server';

// Admin UI sends a flat permission list; we split into platform + default-org
// scopes server-side until the UI grows two dedicated surfaces.
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const BaseUserBody = z.object({
	email: z.string().email('Valid email is required'),
	permissions: z.array(FlatPermissionSchema)
});
const PasswordUserBody = BaseUserBody.extend({
	password: z.string().min(8, 'Password must be at least 8 characters').optional()
});

// GET — list all users with a flat "permissions" projection for the admin UI.
export const GET: RequestHandler = async ({ locals }) => {
	requireManageInstanceUsers(locals);
	const page = await getAuthProvider().listUsers({ limit: 200 });
	if (page === null) {
		throw error(
			501,
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
	const flattened = await Promise.all(
		page.items.map(async (u) => {
			let orgPerms: readonly string[] = [];
			if (orgId) {
				const member = await orgs.getOrgMember(SYSTEM_CONTEXT, orgId, u.id);
				orgPerms = member?.permissions ?? [];
			}
			const platformPerms = platformByUser.get(u.id) ?? [];
			return {
				...u,
				platformPermissions: platformPerms,
				permissions: flattenPermissions(
					platformPerms,
					orgPerms as Parameters<typeof flattenPermissions>[1]
				)
			};
		})
	);
	return json(flattened);
};

// POST — create a user + attach to default org with split permissions.
export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageInstanceUsers(locals);
	const auth = getAuthProvider();

	const body = await request.json().catch(() => null);
	const parsed = PasswordUserBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { email, password, permissions } = parsed.data;
	const { platform, org } = splitFlatPermissions(permissions);

	// Only an existing platform admin may create a user with platform-scope perms.
	if (platform.length > 0 && !hasPermission(locals.ctx!, 'instance_admin')) {
		throw error(403, 'Only a platform admin can grant platform-scope permissions');
	}

	try {
		let user;
		if (auth.passwordAuth) {
			if (!password) throw error(400, 'Password is required');
			user = await auth.passwordAuth.createUserWithPassword(email, password);
		} else if (auth.createUser) {
			user = await auth.createUser(email);
		} else {
			throw error(
				501,
				`User creation is not supported by ${auth.name}. Users are managed externally.`
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
