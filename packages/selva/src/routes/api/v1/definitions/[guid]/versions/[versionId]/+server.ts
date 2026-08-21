import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { deleteVersion, getVersion } from '$lib/server/api/handlers/definitionVersions';

export const GET: RequestHandler = mount('Failed to load version', getVersion);
export const DELETE: RequestHandler = mount('Failed to delete version', deleteVersion);
