import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { runPlatformProjectGrantStoreConformance } from '@selvajs/platform/testing';
import { SYSTEM_CONTEXT, type PlatformProjectGrant, type RequestContext } from '@selvajs/platform';
import type { ClientBundle } from '../client.js';
import { SupabasePlatformProjectGrantStore } from '../SupabasePlatformProjectGrantStore.js';
import { SupabaseProjectStore } from '../SupabaseProjectStore.js';
import { SupabaseOrgStore } from '../SupabaseOrgStore.js';
import { SupabaseDataProvider } from '../SupabaseDataProvider.js';
import {
	actAs,
	migratedDb,
	seedOrg,
	seedOrgMember,
	seedProjectMember,
	seedUser
} from './pglite-harness.js';
import { pgliteClientBundle } from './pglite-postgrest.js';

let db: PGlite;
let bundle: ClientBundle;
let hostOrg: string;
let hostOwner: string;

beforeAll(async () => {
	db = await migratedDb();
	bundle = pgliteClientBundle(db);
	hostOwner = await seedUser(db);
	hostOrg = await seedOrg(db, hostOwner);
});

async function seedPlatformProject(id: string = crypto.randomUUID()): Promise<string> {
	await db.query(
		`insert into selva.projects (id, org_id, owner_id, name, slug, visibility)
		 values ($1, $2, $3, $4, $4, 'platform')`,
		[id, hostOrg, hostOwner, id.slice(0, 8)]
	);
	return id;
}

async function seedGrant(
	projectId: string,
	granteeType: 'org' | 'user',
	granteeId: string,
	createdBy: string = hostOwner
): Promise<PlatformProjectGrant> {
	const grant: PlatformProjectGrant = {
		id: crypto.randomUUID(),
		projectId,
		granteeType,
		granteeId,
		canSolve: false,
		createdBy,
		createdAt: new Date().toISOString()
	};
	await new SupabasePlatformProjectGrantStore(bundle).create(SYSTEM_CONTEXT, grant);
	return grant;
}

const asUser = (userId: string): RequestContext => ({
	userId,
	platformPermissions: [],
	orgPermissions: [],
	adapterContext: { sessionToken: userId }
});

const grantCount = async (projectId: string) =>
	(
		await db.query<{ n: number }>(
			`select count(*)::int as n from selva.platform_project_grants where project_id = $1`,
			[projectId]
		)
	).rows[0].n;

describe('SupabasePlatformProjectGrantStore', () => {
	runPlatformProjectGrantStoreConformance({
		name: 'SupabasePlatformProjectGrantStore (system)',
		createStore: () => new SupabasePlatformProjectGrantStore(bundle),
		seedProject: async (id) => {
			await seedPlatformProject(id);
		},
		strictDenials: true
	});

	runPlatformProjectGrantStoreConformance({
		name: 'SupabasePlatformProjectGrantStore (instance admin session)',
		createStore: () => new SupabasePlatformProjectGrantStore(bundle),
		seedProject: async (id) => {
			await seedPlatformProject(id);
		},
		strictDenials: true,
		userCtx: true,
		seedUser: async (id) => {
			await db.query(`insert into auth.users (id) values ($1)`, [id]);
			await db.query(
				`update selva.user_profiles set platform_permissions = '{instance_admin}' where user_id = $1`,
				[id]
			);
			return { userId: id, sessionToken: id };
		}
	});
});

describe('platform projects under RLS', () => {
	const visibleProjects = async (user: string, project: string) =>
		actAs(db, { sub: user }, `select id from selva.projects where id = $1`, [project]);

	it('opens a platform project to a user grantee, and to no one else', async () => {
		const project = await seedPlatformProject();
		const grantee = await seedUser(db);
		const stranger = await seedUser(db);
		await seedGrant(project, 'user', grantee);

		expect(await visibleProjects(grantee, project)).toHaveLength(1);
		expect(await visibleProjects(stranger, project)).toHaveLength(0);
	});

	it('opens a platform project to members of a granted org', async () => {
		const project = await seedPlatformProject();
		const founder = await seedUser(db);
		const member = await seedUser(db);
		const guestOrg = await seedOrg(db, founder);
		await seedOrgMember(db, guestOrg, member, 'member');
		await seedGrant(project, 'org', guestOrg);

		expect(await visibleProjects(member, project)).toHaveLength(1);
	});

	it('does not open a platform project through a member row', async () => {
		const project = await seedPlatformProject();
		const creator = await seedUser(db);
		await seedProjectMember(db, project, creator, 'owner');

		expect(await visibleProjects(creator, project)).toHaveLength(0);
	});

	it('shows a grantee only the grants made to them', async () => {
		const project = await seedPlatformProject();
		const grantee = await seedUser(db);
		const other = await seedUser(db);
		const own = await seedGrant(project, 'user', grantee);
		await seedGrant(project, 'user', other);

		const store = new SupabasePlatformProjectGrantStore(bundle);
		const seen = await store.listByProject(asUser(grantee), project);
		expect(seen.map((g) => g.id)).toEqual([own.id]);
	});

	it('refuses a grant written by a session', async () => {
		const project = await seedPlatformProject();
		const user = await seedUser(db);
		await expect(
			actAs(
				db,
				{ sub: user },
				`insert into selva.platform_project_grants (id, project_id, grantee_type, grantee_id)
				 values (gen_random_uuid(), $1, 'user', $2)`,
				[project, user]
			)
		).rejects.toMatchObject({ code: '42501' });
	});
});

describe('grant cleanup', () => {
	it('deleting a project removes its grants', async () => {
		const project = await seedPlatformProject();
		await seedGrant(project, 'user', await seedUser(db));

		await new SupabaseProjectStore(bundle).deleteProject(SYSTEM_CONTEXT, project);

		expect(await grantCount(project)).toBe(0);
	});

	it('deleting an org removes the grants it holds and those on its projects', async () => {
		const founder = await seedUser(db);
		const doomed = await seedOrg(db, founder);
		const held = await seedPlatformProject();
		await seedGrant(held, 'org', doomed);
		const own = crypto.randomUUID();
		await db.query(
			`insert into selva.projects (id, org_id, owner_id, name, slug, visibility)
			 values ($1, $2, $3, $4, $4, 'platform')`,
			[own, doomed, founder, own.slice(0, 8)]
		);
		await seedGrant(own, 'user', founder);

		await new SupabaseOrgStore(bundle).deleteOrg(SYSTEM_CONTEXT, doomed);

		expect(await grantCount(held)).toBe(0);
		expect(await grantCount(own)).toBe(0);
	});

	it('erasing a user removes grants to them and anonymizes grants they made', async () => {
		const project = await seedPlatformProject();
		const leaver = await seedUser(db);
		await seedGrant(project, 'user', leaver);
		const made = await seedGrant(project, 'org', hostOrg, leaver);

		await SupabaseDataProvider.fromBundle(bundle).onUserDeleted(SYSTEM_CONTEXT, leaver);

		const left = await new SupabasePlatformProjectGrantStore(bundle).listByProject(
			SYSTEM_CONTEXT,
			project
		);
		expect(left.map((g) => [g.id, g.createdBy])).toEqual([[made.id, 'deleted']]);
	});
});
