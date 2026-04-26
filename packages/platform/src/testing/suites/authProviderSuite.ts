/**
 * Adapter conformance suite for IAuthProvider.
 *
 * Covers token round-trips, identity verification, password auth (when the
 * provider exposes `passwordAuth`), and admin user management.
 *
 * User-profile state (starring, recent runs, profile mutations) is tested
 * separately by `runUserProfileStoreConformance` against `IUserProfileStore`.
 */

import { describe, it, expect } from 'vitest';
import type { IAuthProvider } from '../../auth/index.js';
import { makeUuid } from './helpers.js';

export interface AuthProviderConformanceOptions {
	/** Name to show in test output (e.g. "LocalAuthProvider"). */
	name: string;
	/**
	 * Factory returning a fresh provider configured with a known password.
	 * `adminPassword` must work with `passwordAuth.verifyLogin(adminEmail, adminPassword)`
	 * for password-capable providers. The factory is responsible for seeding
	 * the admin user (e.g. via `createUserWithPassword`) before returning.
	 *
	 * `adminEmail` defaults to `''` for legacy reasons; new providers should
	 * always return the seeded admin's email.
	 */
	createProvider: () =>
		| Promise<{ provider: IAuthProvider; adminPassword: string; adminEmail?: string }>
		| { provider: IAuthProvider; adminPassword: string; adminEmail?: string };
	/**
	 * Set to true when the provider is wired with a backend so that
	 * createUser / listUsers / updateUserPlatformPermissions / deleteUser tests run.
	 * When false those methods are expected to return null / 'not_supported'.
	 */
	userManagement?: boolean;
}

export function runAuthProviderConformance(opts: AuthProviderConformanceOptions): void {
	const { name, createProvider, userManagement = false } = opts;

	describe(`IAuthProvider conformance: ${name}`, () => {
		// ============================================================================
		// Token round-trips
		// ============================================================================

		it('verifyLogin returns a session token that verifyToken accepts', async () => {
			const { provider, adminPassword, adminEmail = '' } = await createProvider();
			const result = await provider.passwordAuth!.verifyLogin(adminEmail, adminPassword);
			expect(result.kind).toBe('success');
			if (result.kind !== 'success') return;
			const verified = await provider.verifyToken(result.sessionToken);
			expect(verified?.id).toBe(result.user.id);
		});

		it('verifyToken returns null for a garbage token', async () => {
			const { provider } = await createProvider();
			const result = await provider.verifyToken('not-a-valid-token');
			expect(result).toBeNull();
		});

		it('verifyToken returns null for an empty string', async () => {
			const { provider } = await createProvider();
			const result = await provider.verifyToken('');
			expect(result).toBeNull();
		});

		// ============================================================================
		// Password auth (only runs when passwordAuth is present)
		// ============================================================================

		it('verifyLogin returns success with correct password', async () => {
			const { provider, adminPassword, adminEmail = '' } = await createProvider();
			if (!provider.passwordAuth) return;
			const result = await provider.passwordAuth.verifyLogin(adminEmail, adminPassword);
			expect(result.kind).toBe('success');
			if (result.kind !== 'success') return;
			// Identity-only — platform permissions live on IPlatformPermissionStore now.
			expect(result.user.id).toBeTruthy();
			expect(typeof result.sessionToken).toBe('string');
			expect(result.sessionToken.length).toBeGreaterThan(0);
		});

		it('verifyLogin returns failed for wrong password', async () => {
			const { provider, adminEmail = '' } = await createProvider();
			if (!provider.passwordAuth) return;
			const result = await provider.passwordAuth.verifyLogin(adminEmail, 'wrong-password-xyz');
			expect(result.kind).toBe('failed');
		});

		// ============================================================================
		// getUser
		// ============================================================================

		it('getUser returns null for unknown id', async () => {
			const { provider } = await createProvider();
			// Valid UUID shape but not an actual user — stricter backends (Postgres
			// uuid columns) reject non-UUID ids outright, so we never send those.
			const result = await provider.getUser(makeUuid());
			expect(result).toBeNull();
		});

		// ============================================================================
		// User management (opt-in)
		// ============================================================================

		if (userManagement) {
			it('passwordAuth.createUserWithPassword + getUser returns the created user', async () => {
				const { provider } = await createProvider();
				const email = `test-${makeUuid()}@example.com`;
				const created = await provider.passwordAuth!.createUserWithPassword(email, 'password1234');
				expect(created).toBeTruthy();
				const fetched = await provider.getUser(created.id);
				expect(fetched?.id).toBe(created.id);
				expect(fetched?.email).toBe(email);
			});

			it('createUserWithPassword allows login with the new credentials', async () => {
				const { provider } = await createProvider();
				const email = `login-${makeUuid()}@example.com`;
				await provider.passwordAuth!.createUserWithPassword(email, 'secret9999');
				const result = await provider.passwordAuth!.verifyLogin(email, 'secret9999');
				expect(result.kind).toBe('success');
				if (result.kind !== 'success') return;
				expect(result.user.email).toBe(email);
			});

			it('listUsers returns created users', async () => {
				const { provider } = await createProvider();
				const a = `a-${makeUuid()}@example.com`;
				const b = `b-${makeUuid()}@example.com`;
				await provider.passwordAuth!.createUserWithPassword(a, 'pass12345678');
				await provider.passwordAuth!.createUserWithPassword(b, 'pass12345678');
				const page = await provider.listUsers({ limit: 200 });
				expect(page).toBeTruthy();
				const emails = page!.items.map((u) => u.email);
				expect(emails).toContain(a);
				expect(emails).toContain(b);
			});

			it('deleteUser removes the user', async () => {
				const { provider } = await createProvider();
				const email = `del-${makeUuid()}@example.com`;
				const created = await provider.passwordAuth!.createUserWithPassword(email, 'pass12345678');
				const result = await provider.deleteUser(created.id);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created.id);
				expect(fetched).toBeNull();
			});

			it('deleteUser returns not_found for unknown user', async () => {
				const { provider } = await createProvider();
				const result = await provider.deleteUser(makeUuid());
				expect(result).toBe('not_found');
			});

			// Note: the §2 sole-`instance_admin` invariant is no longer enforced
			// by IAuthProvider — it lives on IPlatformPermissionStore now and
			// callers consult `countInstanceAdminsExcluding` before destructive
			// ops. Auth-side delete/disable just deletes the identity and
			// trusts the caller. See `runPlatformPermissionStoreConformance`
			// for the invariant tests.

			it('createUserWithPassword returns an identity record without profile fields', async () => {
				const { provider } = await createProvider();
				const user = await provider.passwordAuth!.createUserWithPassword(
					`new-${makeUuid()}@example.com`,
					'pass12345678'
				);
				// §1e: profile state (starred, recentRuns, displayName) lives on
				// IUserProfileStore. Platform permissions live on
				// IPlatformPermissionStore. AuthUser is identity-only.
				expect(
					(user as unknown as { starredDefinitions?: unknown }).starredDefinitions
				).toBeUndefined();
				expect((user as unknown as { recentRuns?: unknown }).recentRuns).toBeUndefined();
				expect((user as unknown as { displayName?: unknown }).displayName).toBeUndefined();
				expect(
					(user as unknown as { platformPermissions?: unknown }).platformPermissions
				).toBeUndefined();
			});

			it('disableUser disables a user', async () => {
				const { provider } = await createProvider();
				const created = await provider.passwordAuth!.createUserWithPassword(
					`disable-${makeUuid()}@example.com`,
					'pass12345678'
				);
				const result = await provider.disableUser(created.id);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created.id);
				expect(fetched?.disabled).toBe(true);
			});

			it('disableUser returns not_found for unknown user', async () => {
				const { provider } = await createProvider();
				const result = await provider.disableUser(makeUuid());
				expect(result).toBe('not_found');
			});
		} else {
			it('listUsers returns null when user management is not supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.listUsers();
				expect(result).toBeNull();
			});

			it('createUser (allowlist) is undefined when user management is not supported', async () => {
				const { provider } = await createProvider();
				expect(provider.createUser).toBeUndefined();
			});

			it('deleteUser returns not_supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.deleteUser(makeUuid());
				expect(result).toBe('not_supported');
			});

			it('disableUser returns not_supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.disableUser(makeUuid());
				expect(result).toBe('not_supported');
			});
		}
	});
}
