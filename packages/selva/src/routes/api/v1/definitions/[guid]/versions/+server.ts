import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { listVersions, uploadVersion } from '$lib/server/api/handlers/definitionVersions';

export const GET: RequestHandler = mount('Failed to list versions', listVersions);
export const POST: RequestHandler = mount('Failed to upload definition version', uploadVersion);
