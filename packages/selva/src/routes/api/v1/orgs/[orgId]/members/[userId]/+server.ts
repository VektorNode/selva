import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { removeOrgMember, updateOrgMember } from '$lib/server/api/handlers/orgMembers';

export const PATCH: RequestHandler = mount('Failed to update member', updateOrgMember);
export const DELETE: RequestHandler = mount('Failed to remove member', removeOrgMember);
