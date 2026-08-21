import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { reclaimProject } from '$lib/server/api/handlers/reclaim';

export const POST: RequestHandler = mount('Failed to reclaim project', reclaimProject);
