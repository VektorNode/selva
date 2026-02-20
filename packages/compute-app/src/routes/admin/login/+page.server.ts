import { redirect, fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { verifyPassword, createSession } from '$lib/server/admin-auth.server';

export const actions = {
  default: async ({ request, cookies }) => {
    console.error('LOGIN ACTION CALLED');
    const data = await request.formData();
    const password = data.get('password');

    console.error('Password attempt:', !!password);

    if (!password || typeof password !== 'string') {
      return fail(400, { error: 'Password is required' });
    }

    if (!verifyPassword(password)) {
      console.error('Invalid password');
      return fail(401, { error: 'Invalid password' });
    }

    console.error('Password valid, creating session');
    createSession(cookies);
    throw redirect(303, '/admin');
  }
} satisfies Actions;
