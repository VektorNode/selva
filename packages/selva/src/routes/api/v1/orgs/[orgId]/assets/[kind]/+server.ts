import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { removeOrgAsset, uploadOrgAsset } from '$lib/server/api/handlers/orgAssets';

export const POST: RequestHandler = mount('Failed to upload asset', uploadOrgAsset);
export const DELETE: RequestHandler = mount('Failed to remove asset', removeOrgAsset);
