import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Organization } from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT } from '@selvajs/platform';
import { getOrganizationProvider, getTenancy } from '$lib/server/providers.server';

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
		rows = await Promise.all(
			page.items.map(async (org): Promise<OrgRow> => {
				let memberCount = 0;
				try {
					const members = await orgs.listOrgMembers(SYSTEM_CONTEXT, org.id, { limit: 1000 });
					memberCount = members.items.length;
				} catch {
					// non-fatal
				}
				return { ...org, memberCount };
			})
		);
	} catch {
		// listOrgs unavailable — show empty
	}

	return { orgs: rows };
};
