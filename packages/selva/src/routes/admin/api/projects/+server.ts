import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { flag, getProjectProvider, getOrganizationProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import { ProviderError, SYSTEM_CONTEXT, type Project } from '@selvajs/platform';

const MAX_SLUG_ATTEMPTS = 25;

function isSlugConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_id_slug_key/.test(err.message)
	);
}

function isNameConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_name_unique/.test(err.message)
	);
}

const CreatePlatformProjectBody = z.object({
	name: z.string().min(1, 'Project name is required').max(128).trim(),
	description: z.string().max(2000).optional(),
	/**
	 * Org that physically hosts the project. Storage routing and compute
	 * resolution use this — but org membership in this org does NOT grant
	 * access. Visibility = 'platform' overrides those defaults.
	 *
	 * If omitted, the platform admin's first available org is used.
	 */
	orgId: z.string().uuid().optional()
});

/**
 * §4a — list every platform-visibility project on the instance. Uses
 * `SYSTEM_CONTEXT` because admin reads cross every org boundary; the route is
 * gated on `instance_admin`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	requireInstanceAdmin(locals);
	if (!flag('ENABLE_PLATFORM_PROJECTS')) throw error(404, 'Not found');
	try {
		// Listing across orgs requires walking each org. Fast enough for the
		// admin surface; if instance scale ever demands it, add a dedicated
		// `listPlatform()` to IProjectStore.
		const orgs = await getOrganizationProvider().listOrgs(SYSTEM_CONTEXT, { limit: 1000 });
		const all: Project[] = [];
		for (const org of orgs.items) {
			const page = await getProjectProvider().listProjects(SYSTEM_CONTEXT, org.id, {
				limit: 1000
			});
			for (const p of page.items) {
				if (p.visibility === 'platform') all.push(p);
			}
		}
		return json({ projects: all });
	} catch (err) {
		handleApiError(err, 'Failed to list platform projects');
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireInstanceAdmin(locals);
	if (!flag('ENABLE_PLATFORM_PROJECTS')) throw error(404, 'Not found');
	const ctx = locals.ctx!;

	const body = await request.json().catch(() => null);
	const parsed = CreatePlatformProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	// Resolve the host org. Admin's `actingOrgId` is the natural default; if
	// they pass an explicit `orgId`, validate it exists.
	const hostOrgId = parsed.data.orgId ?? ctx.actingOrgId;
	if (!hostOrgId) {
		throw error(400, 'A host orgId is required (no active organization in context).');
	}
	const hostOrg = await getOrganizationProvider().getOrg(SYSTEM_CONTEXT, hostOrgId);
	if (!hostOrg) throw error(400, `Host organization '${hostOrgId}' not found.`);

	const projectStore = getProjectProvider();
	const baseSlug = slugify(parsed.data.name) || 'platform-project';
	const now = new Date().toISOString();
	const projectId = randomUUID();

	for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
		const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
		const project: Project = {
			id: projectId,
			orgId: hostOrgId,
			name: parsed.data.name,
			slug,
			description: parsed.data.description,
			visibility: 'platform',
			ownerId: user.id,
			createdBy: user.id,
			updatedBy: user.id,
			autoJoinOnUpload: false,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		try {
			await projectStore.createProject(SYSTEM_CONTEXT, project);
			return json(project, { status: 201 });
		} catch (err) {
			if (isNameConflict(err)) {
				throw error(409, 'A project with that name already exists in the host organization.');
			}
			if (isSlugConflict(err)) continue;
			handleApiError(err, 'Failed to create platform project');
		}
	}

	throw error(409, 'Could not pick a unique project slug after several attempts.');
};
