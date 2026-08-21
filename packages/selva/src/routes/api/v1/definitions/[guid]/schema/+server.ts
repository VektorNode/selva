import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { getDefinitionSchema } from '$lib/server/api/handlers/definitions';

export const GET: RequestHandler = mount('Failed to load definition schema', getDefinitionSchema);
