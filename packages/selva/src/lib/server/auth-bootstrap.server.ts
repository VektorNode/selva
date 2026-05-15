import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type AuthUser,
	type Organization,
	type Project,
	type TenancyMode
} from '@selvajs/platform';
import {
	getAuthProvider,
	getDataProvider,
	getOrganizationProvider,
	getPermissionStore,
	getProjectProvider,
	tenancy
} from './providers.server.js';
import { slugify } from './slug.js';

/**
 * Shared post-verification flow used by every IdP-callback route (OAuth,
 * email link, future SAML, …). Order matters:
 *
 *   1. `data.ensureUser` — guarantee a user-data row exists for whatever ID
 *      the auth provider issued. Local-provider creates a JSON row;
 *      Supabase no-ops (its DB trigger has already fired).
 *   2. Bootstrap-admin grant — if no instance_admin exists yet AND the
 *      tenancy/env policy allows it, grant the signing-in user every
 *      platform permission so `/admin` becomes reachable.
 *   3. Single-tenant org seed — create the default Organization + Project
 *      owned by the new admin, mirroring what `/setup` does for password
 *      auth. Without this, org-scoped permissions (manage_projects,
 *      manage_definitions) silently drop on the floor because
 *      `actingOrgId` resolves to undefined.
 *
 * Returns nothing — failures throw. Cookie/redirect are the caller's job
 * since they vary by capability (OAuth has refresh tokens, magic-link does
 * sometimes, SAML doesn't).
 */
export async function bootstrapUserSession(user: AuthUser): Promise<void> {
	await getDataProvider().ensureUser(SYSTEM_CONTEXT, user.id);

	const perms = getPermissionStore();
	const hasAdmin = await perms.hasInstanceAdmin(SYSTEM_CONTEXT);
	let grantedAdminHere = false;
	if (!hasAdmin) {
		if (!shouldBootstrapAdmin(user, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, tenancy)) return;
		await perms.set(SYSTEM_CONTEXT, user.id, [...ALL_PLATFORM_PERMISSIONS]);
		grantedAdminHere = true;
	}

	// Self-heal: deployments that skipped /setup (header-auth, OAuth callback)
	// were left without a default org until 2026-05 — `actingOrgId` resolved
	// to undefined and org-scoped permissions silently dropped. We seed the
	// org if it's missing. After it exists this is a single cheap listOrgs
	// read per request and an early-return.
	if (tenancy !== 'single') return;
	const orgs = getOrganizationProvider();
	const existing = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
	if (existing.items.length > 0) return;

	// Only the instance admin gets to own the freshly-created org. We just
	// granted it above (skip the read) or we re-check for the self-heal path.
	if (!grantedAdminHere) {
		const userPerms = await perms.getFor(SYSTEM_CONTEXT, user.id);
		if (!userPerms.includes('instance_admin')) return;
	}
	await ensureSingleTenantDefaultOrg(user);
}

/**
 * Single-tenant deployments must have exactly one org for `actingOrgId` to
 * resolve. The `/setup` form creates it from user input; flows that skip
 * setup (header-auth, OAuth callback, future SAML) need the same seed or
 * org-scoped permissions can't be persisted.
 *
 * No-op outside single-tenant mode and once any org exists. Picks a slug
 * derived from the admin's email/displayName so the URL looks like the
 * deployment rather than a UUID; falls back to `default` for anonymous
 * UPN-only sign-ins.
 */
async function ensureSingleTenantDefaultOrg(user: AuthUser): Promise<void> {
	if (tenancy !== 'single') return;
	const orgs = getOrganizationProvider();
	const existing = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
	if (existing.items.length > 0) return;

	const displayName =
		typeof user.metadata?.displayName === 'string' ? user.metadata.displayName : undefined;
	const orgName = displayName?.trim() || user.email?.split('@')[0]?.trim() || 'Default';
	const slug = slugify(orgName).length >= 3 ? slugify(orgName) : 'default';

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
 * Decide whether the signing-in user qualifies for the first-admin grant
 * (Permissions.md §2). Pure — no I/O — so the policy is testable in
 * isolation.
 *
 * - `tenancy='single'` + no env var → first signer wins (fine for
 *   self-hosted fresh installs).
 * - `tenancy='single'` + env var set → only the named user qualifies.
 * - `tenancy='multi'` → env var REQUIRED; the named user must match the
 *   signer. Without it, the first random signup would become Selva staff.
 *
 * The env var also doubles as the break-glass recovery path
 * (Permissions.md §2) when admin is lost to backup restores or migration
 * drift.
 */
export function shouldBootstrapAdmin(
	user: AuthUser,
	configuredEmail: string | undefined,
	mode: TenancyMode
): boolean {
	const expected = configuredEmail?.trim().toLowerCase();
	if (mode === 'multi' && !expected) return false;
	if (!expected) return true;
	const actual = user.email?.trim().toLowerCase();
	return !!actual && actual === expected;
}

/**
 * Header-auth-specific variant of the bootstrap policy. Used by
 * `wireHeaderAuthBootstrap` to decide whether an unrecognized UPN arriving
 * through the proxy should be auto-allowlisted as the first admin.
 *
 * Same logic as `shouldBootstrapAdmin` but operates on the raw UPN/email
 * before any allowlist row exists. For Entra deployments UPN ≈ email; if
 * they differ, the proxy is expected to forward both and we prefer email
 * when present.
 */
function shouldBootstrapUpn(
	upn: string,
	email: string | undefined,
	configuredEmail: string | undefined,
	mode: TenancyMode
): boolean {
	const expected = configuredEmail?.trim().toLowerCase();
	if (mode === 'multi' && !expected) return false;
	if (!expected) return true;
	const candidate = (email ?? upn).trim().toLowerCase();
	return !!candidate && candidate === expected;
}

/**
 * Wire a bootstrap-allowlist policy onto the auth provider if it supports
 * header-auth-style first-admin bootstrapping. Idempotent — safe to call on
 * every startup; the provider holds the policy until process exit.
 *
 * Header-auth deployments can't reach `/setup` (no password form, no OAuth
 * callback), so without this the first proxy-authenticated visitor is
 * silently rejected (UPN not in allowlist) and the operator has to
 * hand-write JSON files. With it, the first visit whose UPN/email matches
 * `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is auto-allowlisted, and the immediately
 * following `bootstrapUserSession` call grants instance_admin.
 *
 * The policy is gated by `hasInstanceAdmin` — once any admin exists, the
 * policy returns false and the strict allowlist-only behavior resumes.
 * Single-tenant deployments with no env var get the "first signer wins"
 * shape, matching the password/OAuth bootstrap policy.
 */
export function wireHeaderAuthBootstrap(): void {
	const auth = getAuthProvider() as unknown as {
		setBootstrapAllowlistPolicy?: (
			policy: ((p: { upn: string; email: string | undefined }) => boolean | Promise<boolean>) | null
		) => void;
	};
	if (typeof auth.setBootstrapAllowlistPolicy !== 'function') {
		// A stale @selvajs/header-auth-provider build (pre-0.11) doesn't expose
		// this hook. Without a warning the operator sees `user:null` indefinitely
		// and has no signal that they need to upgrade or hand-seed the allowlist.
		if (env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL?.trim()) {
			console.warn(
				'[selva] BOOTSTRAP_INSTANCE_ADMIN_EMAIL is set but the installed ' +
					'@selvajs/header-auth-provider does not expose setBootstrapAllowlistPolicy. ' +
					'Upgrade the provider, or hand-seed header-allowlist.json.'
			);
		}
		return;
	}

	auth.setBootstrapAllowlistPolicy(async ({ upn, email }) => {
		const hasAdmin = await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT);
		if (hasAdmin) return false;
		return shouldBootstrapUpn(upn, email, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, tenancy);
	});
}
