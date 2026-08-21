import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { createShareLink, listShareLinks } from '$lib/server/api/handlers/shareLinks';

export const GET: RequestHandler = mount('Failed to list share links', listShareLinks);
export const POST: RequestHandler = mount('Failed to create share link', createShareLink);
