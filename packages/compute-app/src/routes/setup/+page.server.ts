import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	ALL_ORG_PERMISSIONS,
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT
} from '@selva/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { setSessionCookie } from '$lib/server/admin-auth.server';

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
			// §1g-core: setup still grants platform_admin to the first user so
			// the existing admin UI remains usable. §1g-ui tightens this to
			// org-owner-only + env-var bootstrap for the platform admin.
			const user = await passwordAuth.createUserWithPassword(email, password, [
				...ALL_PLATFORM_PERMISSIONS
			]);

			// Seed/update the org with the admin's company name. The first call to
			// listOrgs triggers seeding with the newly-created user as owner + all
			// OrgPermissions; the subsequent updateOrg renames it from "Local".
			const orgs = getOrganizationProvider();
			const setupCtx = {
				userId: user.id,
				platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
				orgPermissions: [...ALL_ORG_PERMISSIONS]
			};
			const page = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
			const org = page.items[0];
			if (org) {
				await orgs.updateOrg(setupCtx, org.id, { name: companyName, slug });
			}

			// §1a: `createUserWithPassword` doesn't return a session — matches
			// Supabase's admin.createUser contract. Sign in to mint one.
			const loginResult = await passwordAuth.verifyLogin(email, password);
			if (loginResult.kind !== 'success') {
				return fail(500, { error: 'Account created but login failed. Please sign in manually.' });
			}
			setSessionCookie(cookies, loginResult.sessionToken);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return fail(500, { error: msg });
		}

		redirect(303, '/admin');
	}
} satisfies Actions;
