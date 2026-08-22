import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { uploadDefinitionImage } from '@selvajs/server/handlers';

export const POST: RequestHandler = mount('Failed to upload image', uploadDefinitionImage);
