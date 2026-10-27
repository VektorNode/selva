import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { getMe } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to load identity', getMe);
