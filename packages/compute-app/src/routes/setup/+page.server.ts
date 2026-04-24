import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { createSession } from '$lib/server/admin-auth.server';

function slugify(raw: string): string {
	return raw
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
}

// Redirect away if users already exist — setup is only for a fresh install
export const load: PageServerLoad = async () => {
	const page = await getAuthProvider().listUsers({ limit: 1 });
	if (page === null) {
		// Single-password mode — setup not applicable
		redirect(303, '/login');
	}
	if (page.items.length > 0) {
		redirect(303, '/login');
	}
	return {};
};

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const companyName = (data.get('companyName') as string | null)?.trim() ?? '';
		const email = data.get('email') as string | null;
		const password = data.get('password') as string | null;
		const confirm = data.get('confirm') as string | null;

		if (!companyName) {
			return fail(400, { error: 'Company name is required' });
		}
		const slug = slugify(companyName);
		if (slug.length < 3) {
			return fail(400, { error: 'Company name must contain at least 3 letters or digits' });
		}
		if (!email || !email.includes('@')) {
			return fail(400, { error: 'Valid email is required' });
		}
		if (!password || password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match' });
		}

		try {
			const passwordAuth = getAuthProvider().passwordAuth;
			if (!passwordAuth) {
				return fail(501, { error: 'Password-based setup is not supported by this provider' });
			}
			const user = await passwordAuth.createUserWithPassword(email, password, [
				'platform_admin',
				'manage_users',
				'manage_compute',
				'manage_definitions',
				'manage_projects'
			]);

			// Seed/update the org with the admin's company name. The first call to
			// getOrg triggers seeding with the newly-created user as owner; the
			// subsequent updateOrg renames it from the default "Local".
			const orgs = getOrganizationProvider();
			const ctx = { userId: user.id, permissions: user.permissions };
			const page = await orgs.listOrgs(ctx, { limit: 1 });
			const org = page.items[0];
			if (org) {
				await orgs.updateOrg(ctx, org.id, { name: companyName, slug });
			}

			await createSession(cookies, user);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return fail(500, { error: msg });
		}

		redirect(303, '/admin');
	}
} satisfies Actions;
