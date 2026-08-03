import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import {
	OrgRoleSchema,
	OrgPermissionSchema,
	PlatformPermissionSchema,
	DEFAULT_ORG_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	MAX_PAGE_LIMIT,
	type Invite
} from '@selvajs/platform';
import { splitFlatPermissions } from '$lib/server/permissions-compat.server';
import { hashToken, mintRawToken } from '$lib/server/invites/token.server';

// Accept a flat `permissions[]` from the UI; platform-scope entries are
// silently dropped since invites only grant org rights.
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const CreateBody = z.object({
	email: z
		.string()
		.email('Valid email is required')
		.transform((s) => s.toLowerCase().trim()),
	orgRole: OrgRoleSchema.default('member'),
	permissions: z.array(FlatPermissionSchema).default([])
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// GET — list pending (and recently accepted) invites for the org
export const GET: RequestHandler = async ({ params, locals, url }) => {
	requireManageOrgMembers(locals);
	const { ctx, orgId } = requireActingOrg(locals, params.orgId);

	const rawLimit = Number(url.searchParams.get('limit') ?? 50);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT) : 50;
	const cursor = url.searchParams.get('cursor') ?? undefined;

	try {
		const page = await getInviteStore().listByOrg(ctx, orgId, { limit, cursor });
		// Strip `tokenHash` from the listing — it's the server-side lookup
		// key and an admin in the pending-invites UI has no use for it
		// (the raw token was shown to them once at mint time).
		const items = page.items.map(({ tokenHash: _omit, ...rest }) => rest);
		return json({ items, nextCursor: page.nextCursor });
	} catch (err) {
		handleApiError(err, 'Failed to list invites');
	}
};

// POST — create an invite, return the shareable accept URL
export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	requireManageOrgMembers(locals);
	const { ctx, orgId } = requireActingOrg(locals, params.orgId);
	const user = locals.user!;

	const body = await request.json().catch(() => null);
	const parsed = CreateBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		const { org: submittedOrgPerms } = splitFlatPermissions(parsed.data.permissions);
		// owner/admin always carry the full permission set — the checkbox array
		// from the UI is ignored for those roles. `member` takes the caller's
		// selection, intersected with MEMBER_ASSIGNABLE_PERMISSIONS so governance
		// perms (manage_org_members, manage_org_compute) can't be granted to members.
		const orgPermissions =
			parsed.data.orgRole === 'member'
				? submittedOrgPerms.filter((p) => MEMBER_ASSIGNABLE_PERMISSIONS.includes(p))
				: [...DEFAULT_ORG_PERMISSIONS[parsed.data.orgRole]];

		// Mint the raw token + its HMAC digest. The store sees only the digest;
		// the raw token is returned ONCE in this response (embedded in
		// `acceptUrl`) and never persisted server-side. A leak of `invites`
		// rows therefore can't be replayed without the instance secret.
		const rawToken = mintRawToken();
		const now = new Date();
		const invite: Invite = {
			id: randomUUID(),
			tokenHash: hashToken(rawToken),
			email: parsed.data.email,
			orgId,
			orgRole: parsed.data.orgRole,
			orgPermissions,
			invitedBy: user.id,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
		};
		await getInviteStore().create(ctx, invite);

		const acceptUrl = `${url.origin}/accept-invite?token=${rawToken}`;
		// Don't echo the hash back to the caller — it's an opaque server-side
		// identifier with no client use. The acceptUrl is the only thing
		// callers need; the rest of the invite (id, email, orgRole, ...) is
		// useful for the admin UI's pending-invites table.
		const { tokenHash: _omit, ...inviteForClient } = invite;
		// `acceptUrl` carries the raw token and exists only in this response —
		// it is not a field of the stored invite, hence not a resource-name wrapper.
		return json({ ...inviteForClient, acceptUrl }, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create invite');
	}
};
