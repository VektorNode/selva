/**
 * What a signed-in person can't do to API tokens, enforced by the database
 * rather than the app. A key is a bearer credential, so each gap here is
 * either a leaked roster or a key someone else can widen.
 *
 * Every user is a plain one (`seedPlainUser`): the policies short-circuit on
 * `is_instance_admin()`, which would make every assertion pass.
 *
 * The last block signs delegated sessions with the stack's legacy JWT secret
 * and checks PostgREST scopes them exactly like a browser session.
 */

import { describe, beforeEach, it, expect } from 'vitest';
import {
	DEFAULT_ORG_PERMISSIONS,
	SYSTEM_CONTEXT,
	type ApiToken,
	type OrgRole,
	type RequestContext
} from '@selvajs/platform';
import { createClient } from '@supabase/supabase-js';
import { SupabaseApiTokenStore } from '../SupabaseApiTokenStore.js';
import { SupabaseDelegatedSession } from '../../auth/SupabaseDelegatedSession.js';
import { readEnv, resetAllData, seedPlainUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('API token RLS (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	const env = envCtx;
	const store = new SupabaseApiTokenStore(env.bundle);

	const ctxFor = (userId: string, sessionToken: string): RequestContext =>
		({
			userId,
			platformPermissions: [],
			adapterContext: { sessionToken }
		}) as unknown as RequestContext;

	async function seedOrg(ownerId: string): Promise<string> {
		const orgId = crypto.randomUUID();
		const now = new Date().toISOString();
		const { error } = await env.adminClient.from('orgs').insert({
			id: orgId,
			name: 'Token RLS Org',
			slug: `tok-rls-${orgId.slice(0, 8)}`,
			owner_id: ownerId,
			created_at: now,
			updated_at: now
		});
		if (error) throw error;
		return orgId;
	}

	async function addMember(orgId: string, userId: string, role: OrgRole): Promise<void> {
		const { error } = await env.adminClient.from('org_members').insert({
			org_id: orgId,
			user_id: userId,
			role,
			permissions: [...DEFAULT_ORG_PERMISSIONS[role]],
			joined_at: new Date().toISOString()
		});
		if (error) throw error;
	}

	function tokenFor(userId: string, orgId: string, overrides: Partial<ApiToken> = {}): ApiToken {
		const now = Date.now();
		return {
			id: crypto.randomUUID(),
			userId,
			createdBy: userId,
			orgId,
			name: 'rls key',
			tokenHash: `hash-${crypto.randomUUID()}`,
			scopes: ['read:all'],
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + 86_400_000).toISOString(),
			lastUsedAt: null,
			revokedAt: null,
			...overrides
		};
	}

	/** A PostgREST client acting as one session, for writes the store never makes. */
	const rawAs = (sessionToken: string) =>
		createClient(env.url, env.anonKey, {
			db: { schema: 'selva' },
			auth: { persistSession: false, autoRefreshToken: false },
			global: { headers: { Authorization: `Bearer ${sessionToken}` } }
		});

	describe('API token RLS', () => {
		let orgId: string;
		let alice: { userId: string; sessionToken: string };
		let bob: { userId: string; sessionToken: string };
		let admin: { userId: string; sessionToken: string };

		beforeEach(async () => {
			await resetAllData(env);
			alice = await seedPlainUser(env, '');
			bob = await seedPlainUser(env, '');
			admin = await seedPlainUser(env, '');
			orgId = await seedOrg(admin.userId);
			await addMember(orgId, admin.userId, 'admin');
			await addMember(orgId, alice.userId, 'member');
			await addMember(orgId, bob.userId, 'member');
		});

		it("hides another member's token and refuses to revoke it", async () => {
			const t = tokenFor(alice.userId, orgId);
			await store.create(ctxFor(alice.userId, alice.sessionToken), t);
			const asBob = ctxFor(bob.userId, bob.sessionToken);

			expect(await store.get(asBob, t.id)).toBeNull();
			expect((await store.listByOrg(asBob, orgId)).items).toEqual([]);
			await store.revoke(asBob, t.id, 'owner');
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, t.tokenHash)).not.toBeNull();
		});

		it('lets org leadership read the roster and revoke', async () => {
			const t = tokenFor(alice.userId, orgId);
			await store.create(ctxFor(alice.userId, alice.sessionToken), t);
			const asAdmin = ctxFor(admin.userId, admin.sessionToken);

			expect((await store.listByOrg(asAdmin, orgId)).items.map((i) => i.id)).toEqual([t.id]);
			await store.revoke(asAdmin, t.id, 'admin');
			expect((await store.get(asAdmin, t.id))?.revokedAt).toBeTruthy();
		});

		it('refuses minting for someone else or in a foreign org', async () => {
			const asAlice = ctxFor(alice.userId, alice.sessionToken);
			await expect(store.create(asAlice, tokenFor(bob.userId, orgId))).rejects.toThrow();
			const foreign = await seedOrg(bob.userId);
			await expect(store.create(asAlice, tokenFor(alice.userId, foreign))).rejects.toThrow();
		});

		it('lets the owner change nothing but revoked_at, and never read the hash', async () => {
			const t = tokenFor(alice.userId, orgId);
			await store.create(ctxFor(alice.userId, alice.sessionToken), t);
			const client = rawAs(alice.sessionToken);

			const widen = await client
				.from('api_tokens')
				.update({ scopes: ['write:all'] })
				.eq('id', t.id);
			expect(widen.error?.code).toBe('42501');
			const extend = await client
				.from('api_tokens')
				.update({ expires_at: new Date(Date.now() + 1e10).toISOString() })
				.eq('id', t.id);
			expect(extend.error?.code).toBe('42501');
			const hash = await client.from('api_tokens').select('token_hash').eq('id', t.id);
			expect(hash.error?.code).toBe('42501');
		});

		describe('delegated sessions (legacy HS256 secret)', () => {
			const secret = process.env.SUPABASE_JWT_SECRET;

			it.skipIf(!secret)(
				'scopes a minted session to its user, like a browser session',
				async () => {
					const delegated = new SupabaseDelegatedSession({
						supabaseUrl: env.url,
						anonKey: env.anonKey,
						jwtSecret: secret!
					});
					expect(await delegated.status()).toEqual({ ok: true });

					const mine = tokenFor(alice.userId, orgId);
					const theirs = tokenFor(bob.userId, orgId);
					await store.create(ctxFor(alice.userId, alice.sessionToken), mine);
					await store.create(ctxFor(bob.userId, bob.sessionToken), theirs);

					const asAlice = ctxFor(alice.userId, await delegated.mint(alice.userId));
					expect((await store.listByOrg(asAlice, orgId)).items.map((i) => i.id)).toEqual([mine.id]);

					// GoTrue accepts it too: `aud` is set and there's no `session_id` to look up.
					const { data, error } = await createClient(env.url, env.anonKey, {
						auth: { persistSession: false, autoRefreshToken: false }
					}).auth.getUser(await delegated.mint(alice.userId));
					expect(error).toBeNull();
					expect(data.user?.id).toBe(alice.userId);
				}
			);

			it('reports a wrong secret instead of signing with it', async () => {
				const delegated = new SupabaseDelegatedSession({
					supabaseUrl: env.url,
					anonKey: env.anonKey,
					jwtSecret: 'not-the-project-secret-at-all-not-even-close'
				});
				const status = await delegated.status();
				expect(status.ok).toBe(false);
				await expect(delegated.mint(alice.userId)).rejects.toThrow(/rejected/);
			});
		});
	});
}
