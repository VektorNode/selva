// Conformance suite for IAuthProvider: token round-trips, identity, password auth, admin management.

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
	 * `adminEmail` defaults to `''`; a password provider should return the seeded
	 * admin's email.
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
	/** The provider has no `passwordAuth`, so only the core cases apply. */
	passwordless?: boolean;
	/** `passwordAuth.registerUser` is on, so its cases run. */
	selfRegistration?: boolean;
	/**
	 * Run the sign-in contract: a sign-in stamps `lastLoginAt`, a session
	 * refresh never moves it, and a disabled user can't refresh. The sign-in
	 * max age reads `lastLoginAt` as "the identity provider last let this person
	 * in", so a provider that moves it on refresh switches that check off.
	 */
	signInContract?: boolean;
	/**
	 * Sign in and return a refresh token, for the contract's refresh cases. A
	 * password sign-in returns no refresh token, so a provider with
	 * `sessionRefresh` passes its own way of getting one. Absent: those cases skip.
	 */
	signInWithRefreshToken?: (
		email: string,
		password: string
	) => Promise<{ userId: string; refreshToken: string }>;
}

/** Cases every auth provider must pass, password or not. */
export function runAuthCoreConformance(
	opts: Pick<AuthProviderConformanceOptions, 'name' | 'createProvider'>
): void {
	const { name, createProvider } = opts;

	describe(`IAuthProvider core conformance: ${name}`, () => {
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

		it('getUser returns null for unknown id', async () => {
			const { provider } = await createProvider();
			// Valid UUID shape but not an actual user — stricter backends (Postgres
			// uuid columns) reject non-UUID ids outright, so we never send those.
			const result = await provider.getUser(makeUuid());
			expect(result).toBeNull();
		});
	});
}

/** Cases for a provider with `passwordAuth`. */
export function runPasswordAuthConformance(opts: AuthProviderConformanceOptions): void {
	const { name, createProvider, userManagement = false, selfRegistration = false } = opts;

	describe(`IAuthProvider password conformance: ${name}`, () => {
		// Token round-trips
		it('verifyLogin returns a session token that verifyToken accepts', async () => {
			const { provider, adminPassword, adminEmail = '' } = await createProvider();
			const result = await provider.passwordAuth!.verifyLogin(adminEmail, adminPassword);
			expect(result.kind).toBe('success');
			if (result.kind !== 'success') return;
			const verified = await provider.verifyToken(result.sessionToken);
			expect(verified?.id).toBe(result.user.id);
		});

		// Password auth (only runs when passwordAuth is present)
		it('verifyLogin returns success with correct password', async () => {
			const { provider, adminPassword, adminEmail = '' } = await createProvider();
			const result = await provider.passwordAuth!.verifyLogin(adminEmail, adminPassword);
			expect(result.kind).toBe('success');
			if (result.kind !== 'success') return;
			// Identity-only: platform permissions live on IPlatformPermissionStore.
			expect(result.user.id).toBeTruthy();
			expect(typeof result.sessionToken).toBe('string');
			expect(result.sessionToken.length).toBeGreaterThan(0);
		});

		if (selfRegistration) {
			it('registerUser creates an account that can sign in', async () => {
				const { provider } = await createProvider();
				const email = `register-${makeUuid()}@example.com`;

				const user = await provider.passwordAuth!.registerUser!(email, 'pass12345678');

				expect(user?.email).toBe(email);
				const login = await provider.passwordAuth!.verifyLogin(email, 'pass12345678');
				expect(login.kind).toBe('success');
			});
		}

		it('verifyLogin returns failed for wrong password', async () => {
			const { provider, adminEmail = '' } = await createProvider();
			const result = await provider.passwordAuth!.verifyLogin(adminEmail, 'wrong-password-xyz');
			expect(result.kind).toBe('failed');
		});

		// getUser
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

			// Auth-side delete/disable trusts the caller: the sole-`instance_admin`
			// invariant is `runPlatformPermissionStoreConformance`'s to test.

			it('createUserWithPassword returns an identity record without profile fields', async () => {
				const { provider } = await createProvider();
				const user = await provider.passwordAuth!.createUserWithPassword(
					`new-${makeUuid()}@example.com`,
					'pass12345678'
				);
				// Profile state (starred, recentRuns, displayName) lives on
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

			it('verifyLogin refuses a disabled user', async () => {
				const { provider } = await createProvider();
				const email = `disabled-${makeUuid()}@example.com`;
				const created = await provider.passwordAuth!.createUserWithPassword(email, 'pass12345678');
				await provider.disableUser(created.id);

				const result = await provider.passwordAuth!.verifyLogin(email, 'pass12345678');

				expect(result).toMatchObject({ kind: 'failed' });
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

/**
 * Both of the above, gated on what the provider has. New cases go behind an option
 * so a third-party adapter does not turn red on upgrade.
 */
export function runAuthProviderConformance(opts: AuthProviderConformanceOptions): void {
	runAuthCoreConformance(opts);
	if (!opts.passwordless) runPasswordAuthConformance(opts);
	if (opts.signInContract && !opts.passwordless) runSignInContract(opts);
}

/** See `AuthProviderConformanceOptions.signInContract`. */
export function runSignInContract(opts: AuthProviderConformanceOptions): void {
	const { name, createProvider, userManagement = false } = opts;

	describe(`IAuthProvider sign-in contract: ${name}`, () => {
		it('a sign-in stamps lastLoginAt', async () => {
			const { provider, adminPassword, adminEmail = '' } = await createProvider();
			const result = await provider.passwordAuth!.verifyLogin(adminEmail, adminPassword);
			if (result.kind !== 'success') throw new Error('admin sign-in failed');
			const user = await provider.getUser(result.user.id);
			expect(Number.isFinite(Date.parse(user?.lastLoginAt ?? ''))).toBe(true);
		});

		const signIn = opts.signInWithRefreshToken;
		if (signIn) {
			it('a session refresh does not move lastLoginAt', async () => {
				const { provider, adminPassword, adminEmail = '' } = await createProvider();
				const { userId, refreshToken } = await signIn(adminEmail, adminPassword);
				const before = (await provider.getUser(userId))?.lastLoginAt;
				await new Promise((r) => setTimeout(r, 1100));
				expect(await provider.sessionRefresh!.refreshSession(refreshToken)).not.toBeNull();
				expect((await provider.getUser(userId))?.lastLoginAt).toBe(before);
			});
		}

		if (signIn && userManagement) {
			it('a disabled user cannot refresh', async () => {
				const { provider } = await createProvider();
				const email = `refresh-${makeUuid()}@example.com`;
				const created = await provider.passwordAuth!.createUserWithPassword(email, 'pass12345678');
				const { refreshToken } = await signIn(email, 'pass12345678');
				await provider.disableUser(created.id);
				expect(await provider.sessionRefresh!.refreshSession(refreshToken)).toBeNull();
			});
		}
	});
}
