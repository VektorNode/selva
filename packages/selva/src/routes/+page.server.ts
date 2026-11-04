import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** `/` is the public splash. Signed-in users land in the library, which carries recents and stars. */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/library');
};
