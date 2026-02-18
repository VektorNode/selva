import { redirect, fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { verifyPassword, createSession } from '$lib/server/admin-auth.server';

export const actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const password = data.get('password');

    if (!password || typeof password !== 'string') {
      return fail(400, { error: 'Password is required' });
    }

    if (!verifyPassword(password)) {
      return fail(401, { error: 'Invalid password' });
    }

    createSession(cookies);
    throw redirect(303, '/admin');
  }
} satisfies Actions;
