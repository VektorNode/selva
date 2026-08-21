import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { getOrg } from '$lib/server/api/handlers/orgs';

export const GET: RequestHandler = mount('Failed to load organization', getOrg);
