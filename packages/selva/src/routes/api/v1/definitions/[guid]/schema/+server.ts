import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { getDefinitionSchema } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to load definition schema', getDefinitionSchema);
