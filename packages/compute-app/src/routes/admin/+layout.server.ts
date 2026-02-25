import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { verifySession } from '$lib/server/admin-auth.server';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  // Skip auth check for login page
  if (url.pathname === '/admin/login') {
    return {};
  }

  // Verify session for all other admin routes
  if (!verifySession(cookies)) {
    throw redirect(303, '/admin/login');
  }

  return {};
};
