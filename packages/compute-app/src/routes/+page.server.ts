import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async () => {
  // Redirect root to /app which will use default definition
  throw redirect(307, '/app');
}) satisfies PageServerLoad;
