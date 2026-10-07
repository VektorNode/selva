import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { projectScopeTarget } from '@selvajs/server/api';
import { deleteProject, getProject, updateProject } from '@selvajs/server/handlers';

const scopeTarget = projectScopeTarget('id');

export const GET: RequestHandler = mount('Failed to load project', getProject, { scopeTarget });
export const PATCH: RequestHandler = mount('Failed to update project', updateProject, {
	scopeTarget
});
export const DELETE: RequestHandler = mount('Failed to delete project', deleteProject, {
	scopeTarget
});
