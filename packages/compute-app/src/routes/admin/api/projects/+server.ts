import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { randomUUID } from 'node:crypto';
import type { Project } from '@selva/platform/organizations';

export const GET: RequestHandler = async () => {
	try {
		const orgs = getOrganizationProvider();
		const orgList = await orgs.listOrgs();
		const projects = (await Promise.all(orgList.map((org) => orgs.listProjects(org.id)))).flat();
		return json({ projects });
	} catch (err) {
		console.error('[Projects GET] Failed:', err);
		throw error(500, 'Failed to load projects');
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { name, description, visibility } = body as Record<string, unknown>;
	if (!name || typeof name !== 'string' || !name.trim()) throw error(400, 'Project name is required');

	const orgs = getOrganizationProvider();
	const [org] = await orgs.listOrgs();
	if (!org) throw error(500, 'No organization configured');

	const now = new Date().toISOString();
	const slug = (name as string).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

	const project: Project = {
		id: randomUUID(),
		orgId: org.id,
		name: (name as string).trim(),
		slug,
		description: typeof description === 'string' ? description : undefined,
		visibility: (['public', 'org', 'private'].includes(visibility as string) ? visibility : 'public') as Project['visibility'],
		ownerId: locals.user!.id,
		createdAt: now,
		updatedAt: now
	};

	try {
		await orgs.createProject(project);
		return json(project, { status: 201 });
	} catch (err) {
		if (err instanceof Error && err.message.includes('single project')) {
			throw error(403, err.message);
		}
		throw error(500, 'Failed to create project');
	}
};
