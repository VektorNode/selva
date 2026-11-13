import { env } from '#lib/server/env.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type AuthUser,
	type Organization,
	type Project
} from '@selvajs/platform';
import { isSetupToken } from '@selvajs/platform/config';
import {
	getAuthProvider,
	getDataProvider,
	getLogger,
	getOrganizationProvider,
	getPermissionStore,
	getProjectProvider,
	getTenancy
} from './providers.server.js';
import { cookiesAreSecure } from './admin-auth.server.js';
import { orgSlugFromName } from '@selvajs/platform';

// ============================================================================
// Setup-link proof
// ============================================================================

const SETUP_PROOF_COOKIE = 'selva_setup';

/**
 * Keeps a valid setup link across the sign-in round-trip, so an IdP callback
 * can tell the operator from whoever else reached the host first. Lax, not
 * Strict: the OAuth callback arrives as a cross-site redirect.
 */
export function rememberSetupProof(cookies: Cookies, token: string): void {
	cookies.set(SETUP_PROOF_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookiesAreSecure(),
		maxAge: 60 * 60
	});
}

export function hasSetupProof(cookies: Cookies): boolean {
	const hmacKey = env.SELVA_HMAC_KEY;
	return !!hmacKey && isSetupToken(cookies.get(SETUP_PROOF_COOKIE), hmacKey);
}

// The header-auth allowlist policy is called without the request, so the proxy
// path hands it the proof through here.
const proxySetupProof = new AsyncLocalStorage<boolean>();

export function identifyWithSetupProof<T>(
	setupProven: boolean,
	identify: () => Promise<T>
): Promise<T> {
	return proxySetupProof.run(setupProven, identify);
}

// ============================================================================
// First-admin bootstrap
// ============================================================================

/**
 * Shared post-verification flow used by every IdP-callback route (OAuth,
 * email link, future SAML, …). Order matters:
 *
 *   1. `data.ensureUser` — guarantee a user-data row exists for whatever ID
 *      the auth provider issued. Local-provider creates a JSON row;
 *      Supabase no-ops (its DB trigger has already fired).
 *   2. Bootstrap-admin grant — if no instance_admin exists yet AND
 *      `shouldBootstrapAdmin` allows it, grant the signing-in user every
 *      platform permission so `/admin` becomes reachable.
 *   3. Single-tenant org seed — create the default Organization + Project
 *      owned by the new admin, mirroring what `/setup` does for password
 *      auth. Without this, org-scoped permissions (manage_projects,
 *      manage_definitions) silently drop because `actingOrgId` resolves to
 *      undefined.
 *
 * Cookie/redirect are the caller's job since they vary by capability (OAuth
 * has refresh tokens, magic-link does sometimes, SAML doesn't).
 */
export async function bootstrapUserSession(user: AuthUser, setupProven: boolean): Promise<void> {
	await getDataProvider().ensureUser(SYSTEM_CONTEXT, user.id);

	const tenancy = getTenancy();
	const perms = getPermissionStore();
	const hasAdmin = await perms.hasInstanceAdmin(SYSTEM_CONTEXT);
	let grantedAdminHere = false;
	if (!hasAdmin) {
		if (!shouldBootstrapAdmin(user.email, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, setupProven)) return;
		// `claimFirstInstanceAdmin`, not `set`: the probe above and the write are
		// two round-trips, and two eligible sign-ins at the same moment would both
		// see "no admin". The store re-checks under a lock and only one wins.
		grantedAdminHere = await perms.claimFirstInstanceAdmin(SYSTEM_CONTEXT, user.id, [
			...ALL_PLATFORM_PERMISSIONS
		]);
		// Lost the race: an admin now exists and it is not this user. Everything
		// below is org self-heal, which the winner performs.
		if (!grantedAdminHere) return;
	}

	// Self-heal: deployments that skipped /setup (header-auth, OAuth callback)
	// can be left without a default org, dropping org-scoped permissions
	// silently. Seed it if missing; once it exists this is a single cheap
	// listOrgs read per request and an early-return.
	if (tenancy !== 'single') return;
	const orgs = getOrganizationProvider();
	const existing = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
	if (existing.items.length > 0) return;

	// Only the instance admin owns the freshly-created org. Skip the read if
	// we just granted it above; otherwise re-check for the self-heal path.
	if (!grantedAdminHere) {
		const userPerms = await perms.getFor(SYSTEM_CONTEXT, user.id);
		if (!userPerms.includes('instance_admin')) return;
	}
	await ensureSingleTenantDefaultOrg(user);
}

/**
 * Seeds the single default Organization + Project that `actingOrgId` needs
 * to resolve, for flows that skip `/setup` (header-auth, OAuth callback,
 * future SAML). No-op outside single-tenant mode and once any org exists.
 * Slug derives from the admin's email/displayName so the URL looks like the
 * deployment rather than a UUID; falls back to `default` for anonymous
 * UPN-only sign-ins.
 */
async function ensureSingleTenantDefaultOrg(user: AuthUser): Promise<void> {
	if (getTenancy() !== 'single') return;
	const orgs = getOrganizationProvider();
	const existing = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
	if (existing.items.length > 0) return;

	const displayName =
		typeof user.metadata?.displayName === 'string' ? user.metadata.displayName : undefined;
	const orgName = displayName?.trim() || user.email?.split('@')[0]?.trim() || 'Default';
	const slug = orgSlugFromName(orgName);

	const now = new Date().toISOString();
	const org: Organization = {
		id: randomUUID(),
		name: orgName,
		slug,
		ownerId: user.id,
		createdBy: user.id,
		updatedBy: user.id,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
	await orgs.createOrg(SYSTEM_CONTEXT, org);

	const projects = getProjectProvider();
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
}

/**
 * Whether a sign-in may claim the empty instance. Pure, so the policy is
 * unit-testable. The claim has to be proven:
 *
 * - `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` set: only that address. The IdP has
 *   proven it by the time this runs.
 * - Unset: only a browser that opened the setup link, which takes read access
 *   to the deployment's `.env`. Otherwise whoever reached the host first
 *   would become admin.
 *
 * The env var also doubles as the break-glass recovery path when admin is
 * lost to backup restores or migration drift.
 */
export function shouldBootstrapAdmin(
	email: string | undefined,
	configuredEmail: string | undefined,
	setupProven: boolean
): boolean {
	const expected = configuredEmail?.trim().toLowerCase();
	if (!expected) return setupProven;
	const actual = email?.trim().toLowerCase();
	return !!actual && actual === expected;
}

/**
 * Wires a bootstrap-allowlist policy onto the auth provider if it supports
 * header-auth-style first-admin bootstrapping. Idempotent — safe to call on
 * every startup; the provider holds the policy until process exit.
 *
 * Header-auth deployments have no sign-in form or callback, so without this
 * the first proxy-authenticated visitor is silently rejected (UPN not in
 * allowlist) and the operator has to hand-write JSON files. With it, the first
 * visit `shouldBootstrapAdmin` accepts is auto-allowlisted, and the immediately
 * following `bootstrapUserSession` call grants instance_admin. For Entra
 * deployments UPN ≈ email; when the proxy forwards both, the email is matched.
 *
 * Gated by `hasInstanceAdmin` — once any admin exists, the policy returns
 * false and strict allowlist-only behavior resumes.
 */
export function wireHeaderAuthBootstrap(): void {
	const auth = getAuthProvider() as unknown as {
		proxyAuth?: unknown;
		setBootstrapAllowlistPolicy?: (
			policy: ((p: { upn: string; email: string | undefined }) => boolean | Promise<boolean>) | null
		) => void;
	};
	// Non-proxy providers (Local, Supabase) bootstrap admin through /setup or
	// the OAuth callback — this is a no-op for them. Without this guard the
	// warning below misfires for every LocalAuthProvider deployment that sets
	// BOOTSTRAP_INSTANCE_ADMIN_EMAIL.
	if (!auth.proxyAuth) return;

	if (typeof auth.setBootstrapAllowlistPolicy !== 'function') {
		// A stale @selvajs/header-auth-provider build doesn't expose this hook.
		// Without a warning the operator sees `user:null` indefinitely with no
		// signal to upgrade or hand-seed the allowlist.
		if (env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL?.trim()) {
			getLogger().warn(
				'BOOTSTRAP_INSTANCE_ADMIN_EMAIL is set but the installed @selvajs/header-auth-provider ' +
					'does not expose setBootstrapAllowlistPolicy. Upgrade the provider, or hand-seed ' +
					'header-allowlist.json.',
				{ component: 'auth-bootstrap' }
			);
		}
		return;
	}

	auth.setBootstrapAllowlistPolicy(async ({ upn, email }) => {
		const hasAdmin = await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT);
		if (hasAdmin) return false;
		return shouldBootstrapAdmin(
			email ?? upn,
			env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL,
			proxySetupProof.getStore() === true
		);
	});
}
