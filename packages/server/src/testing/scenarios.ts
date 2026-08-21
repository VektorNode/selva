/**
 * The shared cast the handler tests are written against.
 *
 * These compose only the seeders in `./harness.ts`, so they run on whatever
 * provider stack the host built its {@link TestHarness} around. They live here
 * rather than in a host's fixtures because a handler test that travels with its
 * handler needs the same two tenants wherever it runs — a host that reseeds its
 * own Acme with different roles gets different results from the same test.
 */

import type { Organization, Project } from '@selvajs/platform';
import { seedOrg, seedOrgMember, seedProject, seedUser } from './harness.js';
import type { SeededUser, TestHarness } from './harness.js';

export interface AcmeFixture {
	acme: Organization;
	alice: SeededUser;
	bob: SeededUser;
	alicesPrivate: Project;
	acmeOrg: Project;
	acmePublic: Project;
}

/**
 * The primary tenant.
 *
 * **Alice is the org's `ownerId` but her membership row is `admin`.** Those are
 * separate fields and this fixture deliberately makes them disagree, because
 * production can too. Every org-role gate reads the **membership row**, so a
 * test that treats `alice` as "the owner" will invert its own result and pass
 * for the wrong reason — seed an explicit `role: 'owner'` member instead.
 */
export async function seedAcme(h: TestHarness): Promise<AcmeFixture> {
	const alice = await seedUser(h, 'alice@acme.test');
	const bob = await seedUser(h, 'bob@acme.test');
	const acme = await seedOrg(h, { name: 'Acme', slug: 'acme', ownerId: alice.id });
	await seedOrgMember(h, { orgId: acme.id, userId: alice.id, role: 'admin' });
	await seedOrgMember(h, { orgId: acme.id, userId: bob.id, role: 'member' });

	const alicesPrivate = await seedProject(h, {
		orgId: acme.id,
		name: 'Alice Private',
		slug: 'alice-private',
		ownerId: alice.id,
		visibility: 'private'
	});
	const acmeOrg = await seedProject(h, {
		orgId: acme.id,
		name: 'Acme Org Project',
		slug: 'acme-org',
		ownerId: alice.id,
		visibility: 'org'
	});
	const acmePublic = await seedProject(h, {
		orgId: acme.id,
		name: 'Acme Public',
		slug: 'acme-public',
		ownerId: alice.id,
		visibility: 'public'
	});

	return { acme, alice, bob, alicesPrivate, acmeOrg, acmePublic };
}

export interface BigClientFixture {
	bigClient: Organization;
	carol: SeededUser;
}

/**
 * Second tenant. Carol is a member of BigClient — used for cross-org rejection
 * scenarios (Carol acting in BigClient context cannot view Acme data).
 */
export async function seedBigClient(h: TestHarness): Promise<BigClientFixture> {
	const carol = await seedUser(h, 'carol@bigclient.test');
	const bigClient = await seedOrg(h, {
		name: 'BigClient',
		slug: 'bigclient',
		ownerId: carol.id
	});
	await seedOrgMember(h, { orgId: bigClient.id, userId: carol.id, role: 'member' });
	return { bigClient, carol };
}

export interface ThirdOrgFixture {
	initech: Organization;
	dave: SeededUser;
}

/**
 * Third tenant. Dave is a member of Initech — used for cross-org public-visibility
 * scenarios (any authenticated user from any org can view a public project when
 * cross-org public access is enabled).
 */
export async function seedThirdOrg(h: TestHarness): Promise<ThirdOrgFixture> {
	const dave = await seedUser(h, 'dave@initech.test');
	const initech = await seedOrg(h, {
		name: 'Initech',
		slug: 'initech',
		ownerId: dave.id
	});
	await seedOrgMember(h, { orgId: initech.id, userId: dave.id, role: 'member' });
	return { initech, dave };
}
