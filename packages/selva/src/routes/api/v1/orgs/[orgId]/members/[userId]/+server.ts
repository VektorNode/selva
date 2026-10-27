import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { removeOrgMember, updateOrgMember } from '@selvajs/server/handlers';

export const PATCH: RequestHandler = mount('Failed to update member', updateOrgMember);
export const DELETE: RequestHandler = mount('Failed to remove member', removeOrgMember);
