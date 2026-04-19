import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageProjects, throwProviderError } from '$lib/server/access.server';
import { randomUUID } from 'node:crypto';
import { SYSTEM_CONTEXT } from '@selva/platform';
import type { Project } from '@selva/platform';

export const GET: RequestHandler = async ({ locals }) => {
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;
	try {
		const orgs = getOrganizationProvider();
		const orgsPage = await orgs.listOrgs(ctx, { limit: 200 });
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => orgs.listProjects(ctx, org.id, { limit: 200 }))
		);
		const projects = projectPages.flatMap((p) => p.items);
		return json({ projects });
	} catch (err) {
		console.error('[Projects GET] Failed:', err);
		throw error(500, 'Failed to load projects');
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageProjects(locals);
	const ctx = locals.ctx!;
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { name, description, visibility } = body as Record<string, unknown>;
	if (!name || typeof name !== 'string' || !name.trim())
		throw error(400, 'Project name is required');

	const orgs = getOrganizationProvider();
	const orgsPage = await orgs.listOrgs(ctx, { limit: 1 });
	const org = orgsPage.items[0];
	if (!org) throw error(500, 'No organization configured');

	const now = new Date().toISOString();
	const slug = (name as string)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

	const project: Project = {
		id: randomUUID(),
		orgId: org.id,
		name: (name as string).trim(),
		slug,
		description: typeof description === 'string' ? description : undefined,
		visibility: (['public', 'org', 'private'].includes(visibility as string)
			? visibility
			: 'public') as Project['visibility'],
		ownerId: locals.user!.id,
		createdAt: now,
		updatedAt: now
	};

	try {
		await orgs.createProject(ctx, project);
		return json(project, { status: 201 });
	} catch (err) {
		throwProviderError(err, 'Failed to create project');
	}
};
