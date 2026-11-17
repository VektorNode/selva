import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Organization } from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT } from '@selvajs/platform';
import { getOrganizationProvider, getTenancy } from '#lib/server/providers.server.js';

export interface OrgRow extends Organization {
	memberCount: number;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'instance_admin')) redirect(303, '/admin');
	if (getTenancy() === 'single') redirect(303, '/admin');

	const orgs = getOrganizationProvider();

	let rows: OrgRow[] = [];
	try {
		const page = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 200 });
		const counts = await orgs
			.countOrgMembers(
				SYSTEM_CONTEXT,
				page.items.map((org) => org.id)
			)
			.catch(() => new Map<string, number>());
		rows = page.items.map((org) => ({ ...org, memberCount: counts.get(org.id) ?? 0 }));
	} catch {
		// listOrgs unavailable — show empty
	}

	return { orgs: rows };
};
