/**
 * Adapter conformance suite for IAuthProvider.
 *
 * Covers token round-trips, credential verification, fallback/no-users modes,
 * and user management (create, update, delete) with 'not_supported' semantics.
 *
 * Runner-agnostic: callers inject a `{ describe, it, expect }` trio.
 */

import type { IAuthProvider } from '../../auth/index.js';
import { type ConformanceRunner } from './runner.js';

export interface AuthProviderConformanceOptions {
	/** Name to show in test output (e.g. "LocalAuthProvider"). */
	name: string;
	/**
	 * Factory returning a fresh provider configured with a known password.
	 * The returned `adminPassword` must work with `verifyLoginCredentials('', adminPassword)`.
	 */
	createProvider: () =>
		| Promise<{ provider: IAuthProvider; adminPassword: string }>
		| { provider: IAuthProvider; adminPassword: string };
	/**
	 * Set to true when the provider is wired with a users.json backend so that
	 * createUser / listUsers / updateUserPermissions / deleteUser tests run.
	 * When false those methods are expected to return null / 'not_supported'.
	 */
	userManagement?: boolean;
	/** Test runner globals. */
	runner: ConformanceRunner;
}

export function runAuthProviderConformance(opts: AuthProviderConformanceOptions): void {
	const { name, createProvider, runner, userManagement = false } = opts;
	const { describe, it, expect } = runner;

	describe(`IAuthProvider conformance: ${name}`, () => {
		// ============================================================================
		// Token round-trips
		// ============================================================================

		it('createSessionToken + verifyToken returns the same user', async () => {
			const { provider, adminPassword } = await createProvider();
			// Use a real authenticated user so that providers backed by a user store
			// can look up the record during verifyToken.
			const authed = await provider.verifyLoginCredentials('', adminPassword);
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

		it('token from one provider is rejected by another (different secret)', async () => {
			const { provider: p1, adminPassword } = await createProvider();
			const { provider: p2 } = await createProvider();
			const authed = await p1.verifyLoginCredentials('', adminPassword);
			expect(authed).toBeTruthy();
			const token = await p1.createSessionToken(authed!);
			// Two fresh providers may share a secret in some implementations —
			// only assert rejection when secrets differ (token differs too).
			const token2 = await p2.createSessionToken(authed!);
			if (token !== token2) {
				const result = await p2.verifyToken(token);
				expect(result).toBeNull();
			}
		});

		// ============================================================================
		// Login credentials
		// ============================================================================

		it('verifyLoginCredentials returns user for correct password', async () => {
			const { provider, adminPassword } = await createProvider();
			const user = await provider.verifyLoginCredentials('', adminPassword);
			expect(user).toBeTruthy();
			expect(user?.permissions).toContain('platform_admin');
		});

		it('verifyLoginCredentials returns null for wrong password', async () => {
			const { provider } = await createProvider();
			const result = await provider.verifyLoginCredentials('', 'wrong-password-xyz');
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
			it('createUser + getUser returns the created user', async () => {
				const { provider } = await createProvider();
				const created = await provider.createUser('test@example.com', 'pass123', [
					'manage_definitions'
				]);
				expect(created).toBeTruthy();
				const fetched = await provider.getUser(created!.id);
				expect(fetched?.id).toBe(created!.id);
				expect(fetched?.email).toBe('test@example.com');
				expect(fetched?.permissions).toContain('manage_definitions');
			});

			it('createUser allows login with the new credentials', async () => {
				const { provider } = await createProvider();
				await provider.createUser('login@example.com', 'secret99', []);
				const user = await provider.verifyLoginCredentials('login@example.com', 'secret99');
				expect(user).toBeTruthy();
				expect(user?.email).toBe('login@example.com');
			});

			it('listUsers returns created users', async () => {
				const { provider } = await createProvider();
				await provider.createUser('a@example.com', 'pa', []);
				await provider.createUser('b@example.com', 'pb', []);
				const page = await provider.listUsers();
				expect(page).toBeTruthy();
				const emails = page!.items.map((u) => u.email);
				expect(emails).toContain('a@example.com');
				expect(emails).toContain('b@example.com');
			});

			it('updateUserPermissions changes permissions', async () => {
				const { provider } = await createProvider();
				const created = await provider.createUser('u@example.com', 'pw', []);
				const result = await provider.updateUserPermissions(created!.id, ['manage_compute']);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created!.id);
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
				const created = await provider.createUser('del@example.com', 'pw', []);
				const result = await provider.deleteUser(created!.id);
				expect(result).toBe('ok');
				const fetched = await provider.getUser(created!.id);
				expect(fetched).toBeNull();
			});

			it('deleteUser returns not_found for unknown user', async () => {
				const { provider } = await createProvider();
				const result = await provider.deleteUser('ghost');
				expect(result).toBe('not_found');
			});
		} else {
			it('listUsers returns null when user management is not supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.listUsers();
				expect(result).toBeNull();
			});

			it('createUser returns null when user management is not supported', async () => {
				const { provider } = await createProvider();
				const result = await provider.createUser('x@x.com', 'pw', []);
				expect(result).toBeNull();
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
