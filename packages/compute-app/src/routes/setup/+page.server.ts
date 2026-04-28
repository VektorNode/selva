import { redirect, fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type Organization,
	type Project
} from '@selvajs/platform';
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
import { slugify } from '$lib/server/slug';

// Redirect away if a platform admin already exists — setup is only for a
// fresh install. Uses the permission store directly (works for OIDC providers
// that can't enumerate users via `listUsers`).
export const load: PageServerLoad = async () => {
	const hasAdmin = await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT);
	if (hasAdmin) {
		redirect(303, '/login');
	}

	const auth = getAuthProvider();
	const oauthProviders = auth.oauth
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

		const passwordAuth = getAuthProvider().passwordAuth;
		if (!passwordAuth) {
			return fail(501, { error: 'Password-based setup is not supported by this provider' });
		}

		// Identity + admin grant must succeed together — without admin perms the
		// new user can't recover, and `hasInstanceAdmin` returning false would
		// allow setup to be re-run with a duplicate email.
		let user;
		try {
			user = await passwordAuth.createUserWithPassword(email, password);
			await setUserPlatformPermissions(SYSTEM_CONTEXT, user.id, [...ALL_PLATFORM_PERMISSIONS]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return fail(500, { error: msg });
		}

		// Everything below is best-effort: once the admin exists, `load()` will
		// redirect future visitors away from /setup, so we must finish the flow
		// even if a single step fails. Failures are logged; the admin can fix
		// missing pieces from /admin after signing in.
		if (displayName) {
			try {
				await getUserProfileStore().updateProfile(SYSTEM_CONTEXT, user.id, { displayName });
			} catch (err) {
				console.error('[setup] display name update failed:', err);
			}
		}

		if (tenancy === 'single') {
			try {
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
			} catch (err) {
				console.error('[setup] org/project bootstrap failed:', err);
			}
		}

		// `createUserWithPassword` doesn't return a session — matches
		// Supabase's admin.createUser contract. Sign in to mint one.
		const loginResult = await passwordAuth.verifyLogin(email, password);
		if (loginResult.kind !== 'success') {
			return fail(500, { error: 'Account created but login failed. Please sign in manually.' });
		}
		setSessionCookie(cookies, loginResult.sessionToken);

		redirect(303, '/admin');
	}
} satisfies Actions;
