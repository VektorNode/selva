import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Authenticated users go straight to /app; guests see the landing page
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		redirect(303, '/app');
	}
	return {};
};
