/** What only the wired provider can show: rules that span more than one store. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	SYSTEM_CONTEXT as S,
	type ApiToken,
	type DefinitionRecord,
	type Organization,
	type PlatformProjectGrant,
	type Project
} from '@selvajs/platform';
import { LocalDataProvider } from '../LocalDataProvider.js';

const NOW = '2026-01-01T00:00:00.000Z';
const actor = { ownerId: 'u', createdBy: 'u', updatedBy: 'u', createdAt: NOW, updatedAt: NOW };

let dir: string;
let data: LocalDataProvider;

async function seedOrg(id: string): Promise<void> {
	await data.orgs.createOrg(S, { id, name: id, slug: id, ...actor } as Organization);
}

async function seedProject(orgId: string, visibility: Project['visibility']): Promise<string> {
	const id = randomUUID();
	await data.projects.createProject(S, {
		id,
		orgId,
		name: id,
		slug: id,
		visibility,
		...actor
	} as Project);
	return id;
}

async function seedPublished(projectId: string): Promise<string> {
	const guid = randomUUID();
	await data.definitions.create(S, {
		guid,
		projectId,
		displayName: 'D',
		status: 'published',
		...actor
	} as unknown as DefinitionRecord);
	return guid;
}

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-cross-store-'));
	data = LocalDataProvider.fromEnv({ DATA_PATH: dir, SELVA_AT_REST_KEY: 'a'.repeat(64) });
	await seedOrg('acme');
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('listPublic', () => {
	it('lists published definitions in public projects only', async () => {
		const open = await seedPublished(await seedProject('acme', 'public'));
		const closed = await seedPublished(await seedProject('acme', 'private'));

		const page = await data.definitions.listPublic(S);
		const guids = page.items.map((r) => r.guid);

		expect(guids).toContain(open);
		expect(guids).not.toContain(closed);
	});
});

describe('deleteOrg cascade', () => {
	it('removes the org API tokens', async () => {
		await data.apiTokens.create(S, {
			id: 't',
			orgId: 'acme',
			userId: 'u',
			tokenHash: 'h',
			revokedAt: null,
			expiresAt: '2099-01-01T00:00:00.000Z'
		} as unknown as ApiToken);

		await data.orgs.deleteOrg(S, 'acme');

		expect(await data.apiTokens.get(S, 't')).toBeNull();
	});

	it('removes grants held by the org, and grants on its projects', async () => {
		await seedOrg('other');
		const theirs = await seedProject('other', 'platform');
		const mine = await seedProject('acme', 'platform');
		const grant = (projectId: string, granteeId: string) =>
			({
				id: randomUUID(),
				projectId,
				granteeType: 'org',
				granteeId,
				canSolve: true,
				createdBy: 'u',
				createdAt: NOW
			}) as PlatformProjectGrant;
		await data.platformProjectGrants.create(S, grant(theirs, 'acme'));
		await data.platformProjectGrants.create(S, grant(mine, 'other'));

		await data.orgs.deleteOrg(S, 'acme');

		expect(await data.platformProjectGrants.listByProject(S, theirs)).toEqual([]);
		expect(await data.platformProjectGrants.listByProject(S, mine)).toEqual([]);
	});
});
