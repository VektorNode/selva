import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Organization, Project } from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT } from '@selvajs/platform';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';

export interface PlatformProjectRow extends Project {
	hostOrgName: string;
}

export interface OrgOption {
	id: string;
	name: string;
	slug: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'instance_admin')) redirect(303, '/admin');

	const orgs = getOrganizationProvider();
	const projects = getProjectProvider();

	let orgList: Organization[] = [];
	try {
		const page = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1000 });
		orgList = page.items;
	} catch {
		// Listing unavailable — show empty.
	}

	const orgById = new Map(orgList.map((o) => [o.id, o]));

	const rows: PlatformProjectRow[] = [];
	for (const org of orgList) {
		try {
			const page = await projects.listProjects(SYSTEM_CONTEXT, org.id, { limit: 1000 });
			for (const p of page.items) {
				if (p.visibility === 'platform') {
					rows.push({ ...p, hostOrgName: orgById.get(p.orgId)?.name ?? '—' });
				}
			}
		} catch {
			// Skip orgs that fail listing.
		}
	}

	const orgOptions: OrgOption[] = orgList.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));

	return { projects: rows, orgOptions };
};
