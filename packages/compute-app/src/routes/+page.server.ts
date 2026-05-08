import type { PageServerLoad } from './$types';

// Landing page is shown to everyone; authed users get a CTA to /library.
export const load: PageServerLoad = async () => {
	return {};
};
