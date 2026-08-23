import { describe, beforeEach, it } from 'vitest';
import { runAuthProviderConformance, runEmailLinkAuthConformance } from '@selvajs/platform/testing';
import { SupabaseAuthProvider } from '../SupabaseAuthProvider.js';
import { readEnv, resetAllData } from '../../data/__tests__/test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseAuthProvider (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	const ctx = envCtx; // non-null in this branch
	// The auth conformance suite expects `verifyLogin('', adminPassword)` to
	// succeed. Supabase requires a non-empty email, so we seed a deterministic
	// admin email and have the suite use that via the `adminEmail` option.
	const ADMIN_EMAIL = 'admin@conformance.test';
	const ADMIN_PASSWORD = 'conformance-admin-password-1234';

	async function ensureAdmin() {
		const { data: existing } = await ctx.adminClient.auth.admin.listUsers({ perPage: 1000 });
		const match = existing.users.find((u) => u.email === ADMIN_EMAIL);
		if (match) return match.id;
		const { data, error } = await ctx.adminClient.auth.admin.createUser({
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
			email_confirm: true
		});
		if (error) throw error;
		return data.user.id;
	}

	async function makeProvider() {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: ctx.url,
			anonKey: ctx.anonKey,
			serviceRoleKey: ctx.serviceRoleKey
		});
		// Ensure the admin account exists + has instance_admin.
		const id = await ensureAdmin();
		const { error: upError } = await ctx.adminClient
			.from('user_profiles')
			.update({ platform_permissions: ['instance_admin'] })
			.eq('user_id', id);
		if (upError) throw upError;
		return { provider, adminPassword: ADMIN_PASSWORD };
	}

	describe('SupabaseAuthProvider', () => {
		beforeEach(async () => {
			await resetAllData(ctx);
		});

		runAuthProviderConformance({
			name: 'SupabaseAuthProvider',
			createProvider: async () => {
				const { provider, adminPassword } = await makeProvider();
				return { provider, adminPassword, adminEmail: ADMIN_EMAIL };
			},
			userManagement: true
		});

		runEmailLinkAuthConformance({
			name: 'SupabaseEmailLinkAuth',
			createAdapter: async () => {
				const { provider } = await makeProvider();
				return {
					adapter: provider.emailLink,
					// `validEmail` isn't used by the suite for live mail delivery;
					// it just needs to look like a real address. The malformed
					// case is what we actually assert on.
					validEmail: 'real-looking@conformance.test',
					invalidEmail: 'not-an-email-address'
				};
			}
		});
	});
}
