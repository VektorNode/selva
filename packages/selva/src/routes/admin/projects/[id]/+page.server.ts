import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type {
	DefinitionRecord,
	Organization,
	PlatformProjectGrant,
	Project
} from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	flag,
	getAuthProvider,
	getDefinitionMeta,
	getOrganizationProvider,
	getPlatformProjectGrantStore,
	getProjectProvider,
	getUserProfileStore
} from '$lib/server/providers.server';

export interface OrgOption {
	id: string;
	name: string;
	slug: string;
}

export interface UserOption {
	id: string;
	email?: string;
	displayName?: string;
}

export interface GrantRow extends PlatformProjectGrant {
	granteeName: string;
	granteeSubtitle?: string;
}

export interface DefinitionRow {
	guid: string;
	displayName: string;
	status: DefinitionRecord['status'];
	createdAt: string;
	updatedAt: string;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'instance_admin')) redirect(303, '/admin');
	if (!flag('ENABLE_PLATFORM_PROJECTS')) throw error(404, 'Not found');
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	const project: Project | null = await getProjectProvider().getProject(SYSTEM_CONTEXT, id);
	if (!project || project.visibility !== 'platform') {
		throw error(404, 'Platform project not found');
	}

	// Definitions in the project (used for the Definitions tab and as a quick
	// link out to /library/[guid] for upload/edit).
	let definitions: DefinitionRow[] = [];
	try {
		const page = await getDefinitionMeta().listByProject(SYSTEM_CONTEXT, id, { limit: 200 });
		definitions = page.items.map((d) => ({
			guid: d.guid,
			displayName: d.displayName,
			status: d.status,
			createdAt: d.createdAt,
			updatedAt: d.updatedAt
		}));
	} catch {
		// non-fatal — show empty
	}

	// Grants on this project, hydrated with grantee labels.
	let grantRows: GrantRow[] = [];
	let orgList: Organization[] = [];
	let userOptions: UserOption[] = [];
	try {
		// These three reads are independent — run them together instead of serially.
		const auth = getAuthProvider();
		const [grants, orgsPage, usersPage] = await Promise.all([
			getPlatformProjectGrantStore().listByProject(SYSTEM_CONTEXT, id),
			getOrganizationProvider().listOrgs(SYSTEM_CONTEXT, { limit: 1000 }),
			auth.listUsers?.({ limit: 1000 }) ?? Promise.resolve(null)
		]);
		orgList = orgsPage.items;
		const orgById = new Map(orgList.map((o) => [o.id, o]));
		const userById = new Map<string, { email?: string }>();
		if (usersPage) {
			for (const u of usersPage.items) userById.set(u.id, { email: u.email });
			const userIds = usersPage.items.map((u) => u.id);
			const profiles = await getUserProfileStore().getProfiles(SYSTEM_CONTEXT, userIds);
			const profileById = new Map(profiles.map((p) => [p.userId, p]));
			userOptions = usersPage.items.map((u) => ({
				id: u.id,
				email: u.email,
				displayName: profileById.get(u.id)?.displayName
			}));
		}

		grantRows = grants.map((g) => {
			if (g.granteeType === 'org') {
				const org = orgById.get(g.granteeId);
				return {
					...g,
					granteeName: org?.name ?? '(unknown org)',
					granteeSubtitle: org?.slug
				};
			}
			const user = userOptions.find((u) => u.id === g.granteeId);
			return {
				...g,
				granteeName: user?.displayName ?? user?.email ?? '(unknown user)',
				granteeSubtitle: user?.email && user.displayName ? user.email : undefined
			};
		});
	} catch {
		// Non-fatal.
	}

	const orgOptions: OrgOption[] = orgList.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));

	return {
		project,
		definitions,
		grants: grantRows,
		orgOptions,
		userOptions
	};
};
