/**
 * Shared test helpers for Supabase data conformance tests.
 *
 * Every suite starts with a fully wiped DB so tests are isolated. We use the
 * service-role client for both — seeding users in `auth.users` and wiping
 * every relevant table.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildClientBundle, type ClientBundle } from '../client.js';

export interface TestContext {
	url: string;
	anonKey: string;
	serviceRoleKey: string;
	adminClient: SupabaseClient;
	bundle: ClientBundle;
}

export function readEnv(): TestContext | null {
	const url = process.env.SUPABASE_URL;
	const anonKey = process.env.SUPABASE_ANON_KEY;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !anonKey || !serviceRoleKey) return null;
	const adminClient = createClient(url, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const bundle = buildClientBundle({ supabaseUrl: url, anonKey, serviceRoleKey });
	return { url, anonKey, serviceRoleKey, adminClient, bundle };
}

/**
 * Reset every data table this adapter owns. Leaves Supabase-managed tables
 * (`auth.users`, etc.) alone except via `deleteAllAuthUsers` below.
 *
 * Order-sensitive because some FKs don't cascade: we go bottom up from
 * dependents to parents.
 */
export async function resetAllData(ctx: TestContext): Promise<void> {
	await truncate(ctx, 'share_links');
	await truncate(ctx, 'invites');
	// Versions FK to definitions ON DELETE CASCADE, but `definitions` can't
	// be wiped while live/draft pointers reference versions (ON DELETE
	// RESTRICT, spec §6). Null the pointers, drop versions, then drop defs.
	await ctx.adminClient
		.from('definitions')
		.update({ live_version_id: null, draft_version_id: null })
		.not('guid', 'is', null);
	await truncate(ctx, 'definition_versions');
	await truncate(ctx, 'definitions');
	await truncate(ctx, 'project_members');
	// compute defaults have a platform_default sibling — reset all three.
	await truncate(ctx, 'compute_server_org_defaults');
	await truncate(ctx, 'compute_server_shares');
	await resetComputePlatformDefault(ctx);
	await truncate(ctx, 'compute_servers');
	await truncate(ctx, 'org_members');
	await truncate(ctx, 'orgs');
	await truncate(ctx, 'user_profiles');
	await deleteAllAuthUsers(ctx);
}

async function resetComputePlatformDefault(ctx: TestContext): Promise<void> {
	// Singleton row — clear `default_server_id` rather than deleting.
	const { error } = await ctx.adminClient
		.from('compute_server_platform_default')
		.update({ default_server_id: null })
		.eq('singleton', true);
	if (error) throw error;
}

async function truncate(ctx: TestContext, table: string): Promise<void> {
	const { error } = await ctx.adminClient
		.from(table)
		.delete()
		.neq(columnForDeleteAll(table), '00000000-0000-0000-0000-000000000000');
	if (error) throw error;
}

function columnForDeleteAll(table: string): string {
	if (table === 'org_members') return 'user_id';
	if (table === 'project_members') return 'user_id';
	if (table === 'user_profiles') return 'user_id';
	if (table === 'definitions') return 'guid';
	if (table === 'definition_versions') return 'id';
	if (table === 'compute_server_org_defaults') return 'org_id';
	if (table === 'compute_server_shares') return 'server_id';
	return 'id';
}

async function deleteAllAuthUsers(ctx: TestContext): Promise<void> {
	const { data, error } = await ctx.adminClient.auth.admin.listUsers({ perPage: 1000 });
	if (error) throw error;
	for (const user of data.users) {
		const { error: delError } = await ctx.adminClient.auth.admin.deleteUser(user.id);
		if (delError) throw delError;
	}
}

/**
 * Seed an `auth.users` row, mark the user as `instance_admin`, sign in, and
 * return the real id + access token. `auth.admin.createUser` doesn't accept a
 * caller-supplied id — Supabase generates one. The conformance suite calls us
 * with a *suggested* id (for adapters that honor it); we ignore it and return
 * GoTrue's real id.
 *
 * The instance_admin grant is what makes RLS open up for the conformance
 * tests: every policy in the schema accepts `is_instance_admin()` as a
 * universal pass, mirroring the `instance_admin` default in `makeCtx`.
 *
 * The session token is what makes RLS *see* the user at all. Without it, the
 * Supabase client falls back to the anon role and every write fails.
 */
export async function seedUser(
	ctx: TestContext,
	suggestedId: string
): Promise<{ userId: string; sessionToken: string }> {
	return seedUserCore(ctx, suggestedId, { promoteToInstanceAdmin: true });
}

/**
 * Variant of `seedUser` that leaves `platform_permissions` empty. Use this
 * when a test specifically asserts on a fresh user's permission state (e.g.
 * the platform-permission store conformance suite).
 */
export async function seedPlainUser(
	ctx: TestContext,
	suggestedId: string
): Promise<{ userId: string; sessionToken: string }> {
	return seedUserCore(ctx, suggestedId, { promoteToInstanceAdmin: false });
}

async function seedUserCore(
	ctx: TestContext,
	_suggestedId: string,
	opts: { promoteToInstanceAdmin: boolean }
): Promise<{ userId: string; sessionToken: string }> {
	// Unique email per seed so repeated calls don't collide. GoTrue requires
	// an email even for password-less users.
	const email = `conformance-${crypto.randomUUID()}@conformance.test`;
	const password = 'conformance-test-password-1234';
	const { data, error } = await ctx.adminClient.auth.admin.createUser({
		email,
		password,
		email_confirm: true
	});
	if (error) throw error;
	const userId = data.user.id;

	if (opts.promoteToInstanceAdmin) {
		// Trigger auto-created the user_profiles row; promote to instance_admin
		// so every RLS policy treats this user as fully authorized. Mirrors the
		// `instance_admin` default in `makeCtx`.
		const { error: promoteError } = await ctx.adminClient
			.from('user_profiles')
			.update({ platform_permissions: ['instance_admin'] })
			.eq('user_id', userId);
		if (promoteError) throw promoteError;
	}

	// Sign in to get an access token. The conformance suite stuffs this into
	// `adapterContext.sessionToken` and our client.ts uses it to scope the
	// request to this user instead of falling back to anon.
	const signInClient = createClient(ctx.url, ctx.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data: session, error: signInError } = await signInClient.auth.signInWithPassword({
		email,
		password
	});
	if (signInError) throw signInError;
	if (!session.session) throw new Error('seedUser: signInWithPassword returned no session');
	return { userId, sessionToken: session.session.access_token };
}
