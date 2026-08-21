import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { deleteProject, getProject, updateProject } from '$lib/server/api/handlers/projects';

export const GET: RequestHandler = mount('Failed to load project', getProject);
export const PATCH: RequestHandler = mount('Failed to update project', updateProject);
export const DELETE: RequestHandler = mount('Failed to delete project', deleteProject);
