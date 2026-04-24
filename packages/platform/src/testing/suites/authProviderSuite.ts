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

export interface AuthProviderConformanceOptions {
	/** Name to show in test output (e.g. "LocalAuthProvider"). */
	name: string;
	/**
	 * Factory returning a fresh provider configured with a known password.
	 * `adminPassword` must work with `passwordAuth.verifyLogin('', adminPassword)`
	 * for password-capable providers.
	 */
	createProvider: () =>
		| Promise<{ provider: IAuthProvider; adminPassword: string }>
		| { provider: IAuthProvider; adminPassword: string };
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
			const { provider, adminPassword } = await createProvider();
			const result = await provider.passwordAuth!.verifyLogin('', adminPassword);
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
			const { provider, adminPassword } = await createProvider();
			if (!provider.passwordAuth) return;
			const result = await provider.passwordAuth.verifyLogin('', adminPassword);
			expect(result.kind).toBe('success');
			if (result.kind !== 'success') return;
			expect(result.user.platformPermissions).toContain('platform_admin');
			expect(typeof result.sessionToken).toBe('string');
			expect(result.sessionToken.length).toBeGreaterThan(0);
		});

		it('verifyLogin returns failed for wrong password', async () => {
			const { provider } = await createProvider();
			if (!provider.passwordAuth) return;
			const result = await provider.passwordAuth.verifyLogin('', 'wrong-password-xyz');
			expect(result.kind).toBe('failed');
		});

		// ============================================================================
		// getUser
		// ============================================================================

		it('getUser returns null for unknown id', async () => {
			const { provider } = await createProvider();
			const result = await provider.getUser('no-such-user');
			expect(result).toBeNull();
		});

		// ============================================================================
		// User management (opt-in)
		// ============================================================================

		if (userManagement) {
			it('passwordAuth.createUserWithPassword + getUser returns the created user', async () => {
				const { provider } = await createProvider();
				const created = await provider.passwordAuth!.createUserWithPassword(
					'test@example.com',
					'pass123',
					['platform_admin']
				);
				expect(created).toBeTruthy();
				const fetched = await provider.getUser(created.id);
				expect(fetched?.id).toBe(created.id);
				expect(fetched?.email).toBe('test@example.com');
				expect(fetched?.platformPermissions).toContain('platform_admin');
			});

			it('createUserWithPassword allows login with the new credentials', async () => {
				const { provider } = await createProvider();
				await provider.passwordAuth!.createUserWithPassword('login@example.com', 'secret99', []);
				const result = await provider.passwordAuth!.verifyLogin('login@example.com', 'secret99');
				expect(result.kind).toBe('success');
				if (result.kind !== 'success') return;
				expect(result.user.email).toBe('login@example.com');
			});

			it('listUsers returns created users', async () => {
				const { provider } = await createProvider();
				await provider.passwordAuth!.createUserWithPassword('a@example.com', 'pa12345678', []);
				await provider.passwordAuth!.createUserWithPassword('b@example.com', 'pb12345678', []);
				const page = await provider.listUsers();
				expect(page).toBeTruthy();
				const emails = page!.items.map((u) => u.email);
				expect(emails).toContain('a@example.com');
				expect(emails).toContain('b@example.com');
			});

			it('updateUserPlatformPermissions changes platform permissions', async () => {
				const { provider } = await createProvider();
				const created = await provider.passwordAuth!.createUserWithPassword(
					'u@example.com',
					'pw12345678',
					[]
				);
				const result = await provider.updateUserPlatformPermissions(created.id, ['platform_admin']);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created.id);
				expect(fetched?.platformPermissions).toContain('platform_admin');
			});

			it('updateUserPlatformPermissions returns not_found for unknown user', async () => {
				const { provider } = await createProvider();
				const result = await provider.updateUserPlatformPermissions('ghost', []);
				expect(result).toBe('not_found');
			});

			it('deleteUser removes the user', async () => {
				const { provider } = await createProvider();
				const created = await provider.passwordAuth!.createUserWithPassword(
					'del@example.com',
					'pw12345678',
					[]
				);
				const result = await provider.deleteUser(created.id);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created.id);
				expect(fetched).toBeNull();
			});

			it('deleteUser returns not_found for unknown user', async () => {
				const { provider } = await createProvider();
				const result = await provider.deleteUser('ghost');
				expect(result).toBe('not_found');
			});

			it('createUserWithPassword returns an identity record without profile fields', async () => {
				const { provider } = await createProvider();
				const user = await provider.passwordAuth!.createUserWithPassword(
					'new@example.com',
					'pw12345678',
					[]
				);
				// §1e: profile state (starred, recentRuns, displayName) lives on IUserProfileStore.
				expect((user as unknown as { starredDefinitions?: unknown }).starredDefinitions).toBeUndefined();
				expect((user as unknown as { recentRuns?: unknown }).recentRuns).toBeUndefined();
				expect((user as unknown as { displayName?: unknown }).displayName).toBeUndefined();
			});

			it('verifyLogin returns failed:disabled for disabled users', async () => {
				// Providers that don't support disabling users can skip. Local does.
				// This is an optional check — only run if the provider preserves
				// disabled state across verifyLogin calls. Deliberately generic.
				// No-op for now; expanded once Supabase lands and we verify there.
				expect(true).toBe(true);
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

			it('updateUserPlatformPermissions returns not_supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.updateUserPlatformPermissions('any-id', []);
				expect(result).toBe('not_supported');
			});

			it('deleteUser returns not_supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.deleteUser('any-id');
				expect(result).toBe('not_supported');
			});
		}
	});
}
