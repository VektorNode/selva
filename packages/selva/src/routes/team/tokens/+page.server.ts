import { redirect } from '@sveltejs/kit';
import { SYSTEM_CONTEXT, hasPermission, type ApiTokenSummary } from '@selvajs/platform';
import { scopeRefusalsToday } from '@selvajs/server/api';
import { getUserProfileStore, providers } from '$lib/server/providers.server';
import { apiTokenCodec } from '$lib/server/apiTokens/token.server';
import type { TokenRow } from '$lib/apiTokens';
import type { PageServerLoad } from './$types';

export interface RosterRow extends TokenRow {
	ownerName: string | null;
}

const toRow = ({ orgId: _o, createdBy: _c, ...t }: ApiTokenSummary): TokenRow => ({
	...t,
	refusedToday: scopeRefusalsToday(t.id)
});

/**
 * The caller's API tokens in the acting org, plus the org-wide roster for
 * `manage_org_members`. Minting and revoking go through `/api/v1/orgs/{orgId}/tokens`,
 * so this page exercises the same endpoints a host app would.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');

	const store = providers.data.apiTokens;
	const orgId = ctx.actingOrgId ?? null;
	const canManageRoster = hasPermission(ctx, 'manage_org_members');
	const base = {
		orgId,
		available: Boolean(store && apiTokenCodec()),
		canMint: hasPermission(ctx, 'manage_api_tokens'),
		canManageRoster
	};
	if (!store || !orgId) return { ...base, mine: [] as TokenRow[], roster: [] as RosterRow[] };

	const mine = await store.listByOrg(ctx, orgId, { limit: 200, userId: ctx.userId });
	if (!canManageRoster) return { ...base, mine: mine.items.map(toRow), roster: [] as RosterRow[] };

	const all = await store.listByOrg(ctx, orgId, { limit: 500 });
	const ownerIds = [...new Set(all.items.map((t) => t.userId))];
	const profiles = await getUserProfileStore().getProfiles(SYSTEM_CONTEXT, ownerIds);
	const nameById = new Map(profiles.map((p) => [p.userId, p.displayName ?? null]));

	return {
		...base,
		mine: mine.items.map(toRow),
		roster: all.items.map((t) => ({ ...toRow(t), ownerName: nameById.get(t.userId) ?? null }))
	};
};
