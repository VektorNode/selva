/**
 * Every migration applied to PGlite, a real Postgres engine, with Supabase's
 * roles and `auth.*` stubbed. `actAs` replays a request the way PostgREST runs
 * it: one transaction, `set local role`, JWT claims. Covers grants and RLS
 * without a live stack, but not PostgREST or GoTrue themselves.
 */

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'supabase',
	'migrations'
);

// What the migrations expect the Supabase platform to have created.
const SUPABASE_STUBS = `
	create role anon nologin;
	create role authenticated nologin;
	create role service_role nologin;
	create role authenticator nologin;
	create role supabase_auth_admin nologin;

	create schema auth;
	create table auth.users (
		id uuid primary key default gen_random_uuid(),
		email text,
		raw_user_meta_data jsonb not null default '{}',
		raw_app_meta_data jsonb not null default '{}',
		banned_until timestamptz
	);
	create function auth.jwt() returns jsonb language sql stable as $$
		select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
	$$;
	create function auth.uid() returns uuid language sql stable as $$
		select nullif(auth.jwt() ->> 'sub', '')::uuid;
	$$;
	grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
	grant select, insert on auth.users to supabase_auth_admin;

	create schema storage;
	create table storage.objects (id uuid primary key, bucket_id text);
`;

export async function migratedDb(): Promise<PGlite> {
	const db = new PGlite();
	await db.exec(SUPABASE_STUBS);
	const migrations = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	for (const file of migrations) {
		await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
	}
	return db;
}

export interface Claims {
	sub?: string;
	selva_org?: string;
}

/** Runs `sql` as `role`. Rows the policies hide simply do not come back. */
export async function asRole<T>(
	db: PGlite,
	role: string,
	sql: string,
	params: unknown[] = [],
	claims: Claims = {}
): Promise<T[]> {
	return db.transaction(async (tx) => {
		const jwt = JSON.stringify({ role, ...claims });
		await tx.query(`select set_config('request.jwt.claims', $1, true)`, [jwt]);
		await tx.exec(`set local role ${role}`);
		const { rows } = await tx.query<T>(sql, params);
		return rows;
	});
}

/** A signed-in request. */
export function actAs<T = Record<string, unknown>>(
	db: PGlite,
	claims: Claims,
	sql: string,
	params: unknown[] = []
): Promise<T[]> {
	return asRole<T>(db, 'authenticated', sql, params, claims);
}

export async function seedUser(db: PGlite): Promise<string> {
	const { rows } = await db.query<{ id: string }>(
		`insert into auth.users default values returning id`
	);
	return rows[0].id;
}

export async function seedOrg(db: PGlite, owner: string): Promise<string> {
	const id = crypto.randomUUID();
	await db.query(`insert into selva.orgs (id, name, slug, owner_id) values ($1, $2, $3, $4)`, [
		id,
		'Acme',
		`acme-${id.slice(0, 8)}`,
		owner
	]);
	await seedOrgMember(db, id, owner, 'owner', ['manage_org_members']);
	return id;
}

export async function seedOrgMember(
	db: PGlite,
	org: string,
	user: string,
	role: 'owner' | 'admin' | 'member',
	permissions: string[] = []
): Promise<void> {
	await db.query(
		`insert into selva.org_members (org_id, user_id, role, permissions) values ($1, $2, $3, $4)`,
		[org, user, role, permissions]
	);
}

export async function seedProject(
	db: PGlite,
	org: string,
	owner: string,
	opts: { visibility?: 'public' | 'org' | 'private'; commons?: boolean } = {}
): Promise<string> {
	const id = crypto.randomUUID();
	await db.query(
		`insert into selva.projects (id, org_id, owner_id, name, slug, visibility, auto_join_on_upload)
		 values ($1, $2, $3, $4, $4, $5, $6)`,
		[id, org, owner, id.slice(0, 8), opts.visibility ?? 'private', opts.commons ?? false]
	);
	return id;
}

export async function seedProjectMember(
	db: PGlite,
	project: string,
	user: string,
	role: 'owner' | 'editor' | 'viewer'
): Promise<void> {
	await db.query(
		`insert into selva.project_members (project_id, user_id, role) values ($1, $2, $3)`,
		[project, user, role]
	);
}

export async function seedDefinition(
	db: PGlite,
	project: string,
	owner: string,
	opts: { attached?: boolean } = {}
): Promise<string> {
	const guid = crypto.randomUUID();
	await db.query(
		`insert into selva.definitions (guid, project_id, owner_id, display_name, status)
		 values ($1, $2, $3, 'D', 'published')`,
		[guid, project, owner]
	);
	if (opts.attached ?? true) {
		const version = crypto.randomUUID();
		await db.query(
			`insert into selva.definition_versions
				(id, definition_guid, version_number, file_ext, file_key, original_filename, uploaded_by)
			 values ($1, $2, 1, 'gh', 'k', 'd.gh', $3)`,
			[version, guid, owner]
		);
		await db.query(`update selva.definitions set live_version_id = $1 where guid = $2`, [
			version,
			guid
		]);
	}
	return guid;
}

export async function seedShareLink(db: PGlite, definition: string, by: string): Promise<string> {
	const id = crypto.randomUUID();
	await db.query(
		`insert into selva.share_links (id, definition_guid, token_hash, channel, created_by)
		 values ($1, $2, $3, 'live', $4)`,
		[id, definition, `hash-${id}`, by]
	);
	return id;
}
