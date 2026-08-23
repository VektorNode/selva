import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { OrgShareLink } from '@selvajs/platform';
import { SYSTEM_CONTEXT, hasPermission } from '@selvajs/platform';
import { flag, getShareLinkStore, getUserProfileStore } from '$lib/server/providers.server';

/**
 * Org-wide share-link roster.
 *
 * A share link is a bearer credential — the URL is the whole authentication —
 * and until this page existed the only listing was per-definition, so
 * answering "what currently reaches our data?" meant opening every definition
 * by hand. Offboarding depended on that, which is to say it did not happen.
 *
 * Gated on `manage_org_members`, the offboarding permission, not
 * `manage_projects`: the latter can be handed to a plain member (§11), who has
 * no business enumerating every credential in the tenant. Supabase's RLS
 * policy gates on the same permission, so the two agree.
 *
 * Read-only. Revoking still goes through
 * `DELETE /api/v1/definitions/{guid}/share-links/{linkId}`, which requires
 * edit rights on the parent definition — seeing the roster never implies
 * authority over what's in it.
 */

export interface ShareRow extends OrgShareLink {
	/** Minter's display name; null once that user is deleted — the link outlives them. */
	createdByName: string | null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!flag('ENABLE_SHARING')) {
		error(404, 'Share links are disabled on this instance (ENABLE_SHARING).');
	}
	if (!hasPermission(ctx, 'manage_org_members')) redirect(303, '/team');

	const orgId = ctx.actingOrgId;
	if (!orgId) return { rows: [] as ShareRow[] };

	const page = await getShareLinkStore().listByOrg(ctx, orgId, { limit: 500 });

	const minterIds = [...new Set(page.items.map((l) => l.createdBy))];
	const profiles = await getUserProfileStore().getProfiles(SYSTEM_CONTEXT, minterIds);
	const nameById = new Map(profiles.map((p) => [p.userId, p.displayName]));

	const rows: ShareRow[] = page.items.map((link) => ({
		...link,
		createdByName: nameById.get(link.createdBy) ?? null
	}));

	return { rows };
};
