import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { removeOrgAsset, uploadOrgAsset } from '@selvajs/server/handlers';

export const POST: RequestHandler = mount('Failed to upload asset', uploadOrgAsset);
export const DELETE: RequestHandler = mount('Failed to remove asset', removeOrgAsset);
