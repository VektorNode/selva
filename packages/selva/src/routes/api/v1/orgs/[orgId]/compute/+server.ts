import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { getOrgCompute, updateOrgCompute } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to load org compute config', getOrgCompute);
export const PATCH: RequestHandler = mount('Failed to save org compute config', updateOrgCompute);
