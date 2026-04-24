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
	 * `adminPassword` must work with `passwordAuth.verifyLoginCredentials('', adminPassword)`
	 * for password-capable providers.
	 */
	createProvider: () =>
		| Promise<{ provider: IAuthProvider; adminPassword: string }>
		| { provider: IAuthProvider; adminPassword: string };
	/**
	 * Set to true when the provider is wired with a backend so that
	 * createUser / listUsers / updateUserPermissions / deleteUser tests run.
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

		it('createSessionToken + verifyToken returns the same user', async () => {
			const { provider, adminPassword } = await createProvider();
			// Use a real authenticated user so that providers backed by a user store
			// can look up the record during verifyToken.
			const authed = await provider.passwordAuth!.verifyLoginCredentials('', adminPassword);
			expect(authed).toBeTruthy();
			const token = await provider.createSessionToken(authed!);
			const verified = await provider.verifyToken(token);
			expect(verified?.id).toBe(authed!.id);
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

		it('passwordAuth.verifyLoginCredentials returns user for correct password', async () => {
			const { provider, adminPassword } = await createProvider();
			if (!provider.passwordAuth) return;
			const user = await provider.passwordAuth.verifyLoginCredentials('', adminPassword);
			expect(user).toBeTruthy();
			expect(user?.permissions).toContain('platform_admin');
		});

		it('passwordAuth.verifyLoginCredentials returns null for wrong password', async () => {
			const { provider } = await createProvider();
			if (!provider.passwordAuth) return;
			const result = await provider.passwordAuth.verifyLoginCredentials('', 'wrong-password-xyz');
			expect(result).toBeNull();
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
					['manage_definitions']
				);
				expect(created).toBeTruthy();
				const fetched = await provider.getUser(created.id);
				expect(fetched?.id).toBe(created.id);
				expect(fetched?.email).toBe('test@example.com');
				expect(fetched?.permissions).toContain('manage_definitions');
			});

			it('createUserWithPassword allows login with the new credentials', async () => {
				const { provider } = await createProvider();
				await provider.passwordAuth!.createUserWithPassword('login@example.com', 'secret99', []);
				const user = await provider.passwordAuth!.verifyLoginCredentials(
					'login@example.com',
					'secret99'
				);
				expect(user).toBeTruthy();
				expect(user?.email).toBe('login@example.com');
			});

			it('listUsers returns created users', async () => {
				const { provider } = await createProvider();
				await provider.passwordAuth!.createUserWithPassword('a@example.com', 'pa', []);
				await provider.passwordAuth!.createUserWithPassword('b@example.com', 'pb', []);
				const page = await provider.listUsers();
				expect(page).toBeTruthy();
				const emails = page!.items.map((u) => u.email);
				expect(emails).toContain('a@example.com');
				expect(emails).toContain('b@example.com');
			});

			it('updateUserPermissions changes permissions', async () => {
				const { provider } = await createProvider();
				const created = await provider.passwordAuth!.createUserWithPassword('u@example.com', 'pw', []);
				const result = await provider.updateUserPermissions(created.id, ['manage_compute']);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created.id);
				expect(fetched?.permissions).toContain('manage_compute');
				expect(fetched?.permissions).not.toContain('manage_definitions');
			});

			it('updateUserPermissions returns not_found for unknown user', async () => {
				const { provider } = await createProvider();
				const result = await provider.updateUserPermissions('ghost', []);
				expect(result).toBe('not_found');
			});

			it('deleteUser removes the user', async () => {
				const { provider } = await createProvider();
				const created = await provider.passwordAuth!.createUserWithPassword('del@example.com', 'pw', []);
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

			it('createUserWithPassword returns user with empty starredDefinitions and recentRuns', async () => {
				const { provider } = await createProvider();
				const user = await provider.passwordAuth!.createUserWithPassword('new@example.com', 'pw', []);
				expect(user.starredDefinitions).toEqual([]);
				expect(user.recentRuns).toEqual([]);
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

			it('updateUserPermissions returns not_supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.updateUserPermissions('any-id', []);
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
