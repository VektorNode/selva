import { error } from '@sveltejs/kit';
import { flag } from '$lib/server/providers.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (!flag('ENABLE_SHARING')) {
		throw error(404, 'Share links are disabled on this instance (ENABLE_SHARING).');
	}
	return {};
};
