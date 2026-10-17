import { redirect } from '@sveltejs/kit';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	canManageApiTokenRoster,
	listOrgApiTokens,
	type ApiTokenRow
} from '@selvajs/server/handlers';
import { canHoldApiTokens } from '@selvajs/server/tokens';
import { getUserProfileStore, providers } from '$lib/server/providers.server';
import { apiTokenCodec } from '$lib/server/apiTokens/token.server';
import type { TokenRow } from '$lib/apiTokens';
import type { PageServerLoad } from './$types';

export interface RosterRow extends TokenRow {
	ownerName: string | null;
}

const toRow = ({ orgId: _o, createdBy: _c, ...t }: ApiTokenRow): TokenRow => t;

/**
 * The caller's API tokens in the acting org, plus the org-wide roster for
 * `manage_org_members`. Only for people who may hold keys; minting and revoking
 * go through `/api/v1/orgs/{orgId}/tokens`, so this page exercises the same
 * endpoints a host app would.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!canHoldApiTokens(ctx)) redirect(303, '/team');

	const store = providers.data.apiTokens;
	const orgId = ctx.actingOrgId ?? null;
	const canManageRoster = canManageApiTokenRoster(ctx);
	const base = { orgId, available: Boolean(store && apiTokenCodec()), canManageRoster };
	if (!store || !orgId) return { ...base, mine: [] as TokenRow[], roster: [] as RosterRow[] };

	const mine = await listOrgApiTokens(store, ctx, orgId, { limit: 200 });
	if (!canManageRoster) return { ...base, mine: mine.items.map(toRow), roster: [] as RosterRow[] };

	const all = await listOrgApiTokens(store, ctx, orgId, { limit: 500, roster: true });
	const ownerIds = [...new Set(all.items.map((t) => t.userId))];
	const profiles = await getUserProfileStore().getProfiles(SYSTEM_CONTEXT, ownerIds);
	const nameById = new Map(profiles.map((p) => [p.userId, p.displayName ?? null]));

	return {
		...base,
		mine: mine.items.map(toRow),
		roster: all.items.map((t) => ({ ...toRow(t), ownerName: nameById.get(t.userId) ?? null }))
	};
};
