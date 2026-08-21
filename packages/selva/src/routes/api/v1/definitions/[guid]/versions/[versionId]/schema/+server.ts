import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { getVersionSchema } from '$lib/server/api/handlers/definitionVersions';

export const GET: RequestHandler = mount('Failed to load version schema', getVersionSchema);
