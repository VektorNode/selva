import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { createProject, listProjects } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to list projects', listProjects);
export const POST: RequestHandler = mount('Failed to create project', createProject);
