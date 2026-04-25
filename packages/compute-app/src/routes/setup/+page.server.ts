import { redirect, fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type Organization,
	type Project
} from '@selva/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import {
	getOrganizationProvider,
	getPermissionStore,
	getProjectProvider,
	getUserProfileStore,
	tenancy
} from '$lib/server/providers.server';
import { setSessionCookie } from '$lib/server/admin-auth.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';

function slugify(raw: string): string {
	return raw
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
}

// Redirect away if a platform admin already exists — setup is only for a
// fresh install. Uses the permission store directly (works for OIDC providers
// that can't enumerate users via `listUsers`).
export const load: PageServerLoad = async () => {
	const hasAdmin = await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT);
	if (hasAdmin) {
		redirect(303, '/login');
	}

	const auth = getAuthProvider();
	const supportsOAuth =
		typeof (auth as { getOAuthAuthorizationUrl?: unknown }).getOAuthAuthorizationUrl === 'function';
	const oauthProviders = supportsOAuth
		? (process.env.SUPABASE_OAUTH_PROVIDERS ?? '')
				.split(',')
				.map((p) => p.trim())
				.filter((p) => p.length > 0)
		: [];

	return {
		hasPasswordAuth: Boolean(auth.passwordAuth),
		oauthProviders
	};
};

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const companyName = (data.get('companyName') as string | null)?.trim() ?? '';
		const displayName = (data.get('displayName') as string | null)?.trim() || undefined;
		const email = data.get('email') as string | null;
		const password = data.get('password') as string | null;
		const confirm = data.get('confirm') as string | null;

		// In single-tenant mode the first user owns the only org, so company
		// name is required. In multi-tenant mode setup creates only the
		// platform admin — orgs are created separately later.
		const requireCompany = tenancy === 'single';
		if (requireCompany && !companyName) {
			return fail(400, { error: 'Company name is required' });
		}
		const slug = requireCompany ? slugify(companyName) : '';
		if (requireCompany && slug.length < 3) {
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
			// First-run setup creates the identity, then grants every platform
			// permission via the data-layer store. Later deployments will
			// bootstrap the platform admin from an env var instead so setup
			// can be constrained to org-owner rights.
			const user = await passwordAuth.createUserWithPassword(email, password);
			await setUserPlatformPermissions(SYSTEM_CONTEXT, user.id, [
				...ALL_PLATFORM_PERMISSIONS
			]);
			if (displayName) {
				// First-run bootstrap; no authenticated ctx exists yet.
				await getUserProfileStore().updateProfile(SYSTEM_CONTEXT, user.id, { displayName });
			}

			if (tenancy === 'single') {
				// Explicitly bootstrap the single org and a default project. Adapters
				// are pure stores — they no longer auto-seed on read.
				const orgs = getOrganizationProvider();
				const projects = getProjectProvider();
				const now = new Date().toISOString();
				const org: Organization = {
					id: randomUUID(),
					name: companyName,
					slug,
					ownerId: user.id,
					createdBy: user.id,
					updatedBy: user.id,
					createdAt: now,
					updatedAt: now,
					deletedAt: null
				};
				// SYSTEM_CONTEXT bypasses RLS — needed because the new user has no
				// session yet. createOrg seeds the owner membership row in the same
				// call (see SupabaseOrgStore.createOrg / LocalOrgStore.createOrg).
				await orgs.createOrg(SYSTEM_CONTEXT, org);

				const project: Project = {
					id: randomUUID(),
					orgId: org.id,
					name: 'Default',
					slug: 'default',
					visibility: 'public',
					ownerId: user.id,
					createdBy: user.id,
					updatedBy: user.id,
					autoJoinOnUpload: false,
					createdAt: now,
					updatedAt: now,
					deletedAt: null
				};
				await projects.createProject(SYSTEM_CONTEXT, project);
				await projects.addProjectMember(SYSTEM_CONTEXT, {
					projectId: project.id,
					userId: user.id,
					role: 'owner',
					joinedAt: now,
					updatedAt: now,
					updatedBy: user.id,
					deletedAt: null
				});
			}
			// In multi-tenant mode no org is created here; the user lands on a
			// "create your organization" flow after sign-in.

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
