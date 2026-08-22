import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { reclaimProject } from '@selvajs/server/handlers';

export const POST: RequestHandler = mount('Failed to reclaim project', reclaimProject);
