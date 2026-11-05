/**
 * What erasure leaves on disk. The stores are JSON files, so the strongest check
 * is the plain one: the person's id and address appear in none of them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	ERASED_ACTOR_ID,
	SYSTEM_CONTEXT as S,
	type DefinitionRecord,
	type Invite,
	type Organization,
	type PlatformProjectGrant,
	type Project,
	type ShareLink
} from '@selvajs/platform';
import { LocalDataProvider } from '../LocalDataProvider.js';

const NOW = '2026-01-01T00:00:00.000Z';
const EMAIL = 'leaver@x.io';

let dir: string;
let data: LocalDataProvider;
let leaver: string;
let colleague: string;
let orgId: string;
let projectId: string;
let guid: string;

async function diskContents(): Promise<string> {
	const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
	const bodies = await Promise.all(files.map((f) => fs.readFile(path.join(dir, f), 'utf8')));
	return bodies.join('\n');
}

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-erasure-'));
	data = LocalDataProvider.fromEnv({
		DATA_PATH: dir,
		SELVA_AT_REST_KEY: 'a'.repeat(64)
	});
	leaver = randomUUID();
	colleague = randomUUID();
	orgId = randomUUID();
	projectId = randomUUID();
	guid = randomUUID();

	await data.ensureUser(S, leaver);
	await data.orgs.createOrg(S, {
		id: orgId,
		name: 'Acme',
		slug: 'acme',
		ownerId: leaver,
		createdBy: leaver,
		updatedBy: leaver,
		createdAt: NOW,
		updatedAt: NOW
	} as Organization);
	await data.orgs.addOrgMember(S, {
		orgId,
		userId: colleague,
		role: 'owner',
		permissions: [],
		joinedAt: NOW,
		updatedAt: NOW,
		updatedBy: leaver,
		deletedAt: null
	});
	await data.projects.createProject(S, {
		id: projectId,
		orgId,
		name: 'P',
		slug: 'p',
		visibility: 'org',
		ownerId: leaver,
		createdBy: leaver,
		updatedBy: leaver,
		createdAt: NOW,
		updatedAt: NOW
	} as Project);
	await data.definitions.create(S, {
		guid,
		projectId,
		ownerId: leaver,
		createdBy: leaver,
		updatedBy: leaver,
		displayName: 'D',
		status: 'published',
		createdAt: NOW,
		updatedAt: NOW
	} as unknown as DefinitionRecord);
	await data.definitions.createVersion(S, {
		id: randomUUID(),
		definitionId: guid,
		versionNumber: 1,
		fileExt: 'gh',
		fileKey: 'k',
		uploadedBy: leaver,
		uploadedAt: NOW
	} as never);
	await data.invites.create(S, {
		id: randomUUID(),
		tokenHash: 'h',
		email: EMAIL,
		orgId,
		orgRole: 'owner',
		orgPermissions: [],
		invitedBy: colleague,
		createdAt: NOW,
		expiresAt: '2099-01-01T00:00:00.000Z'
	} as unknown as Invite);
	await data.platformProjectGrants.create(S, {
		id: randomUUID(),
		projectId,
		granteeType: 'user',
		granteeId: leaver,
		canSolve: true,
		createdBy: colleague,
		createdAt: NOW
	} as PlatformProjectGrant);
	await data.shareLinks.create(S, {
		id: randomUUID(),
		definitionId: guid,
		channel: 'live',
		tokenHash: 'share',
		createdBy: leaver,
		createdAt: NOW,
		expiresAt: null,
		revokedAt: null,
		allowSolve: true,
		maxSolves: null,
		solveCount: 0
	} as ShareLink);
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('LocalDataProvider.onUserDeleted', () => {
	it('leaves neither their id nor their address on disk', async () => {
		expect(await diskContents()).toContain(leaver);
		expect(await diskContents()).toContain(EMAIL);

		await data.onUserDeleted(S, leaver, { email: EMAIL });

		const after = await diskContents();
		expect(after).not.toContain(leaver);
		expect(after).not.toContain(EMAIL);
	});

	it('stops a pending invite to them resolving', async () => {
		await data.onUserDeleted(S, leaver, { email: EMAIL });
		expect(await data.invites.getByTokenHash(S, 'h')).toBeNull();
	});

	it('keeps what they made, under the erased actor', async () => {
		await data.onUserDeleted(S, leaver, { email: EMAIL });

		expect((await data.orgs.getOrg(S, orgId))?.ownerId).toBe(ERASED_ACTOR_ID);
		expect((await data.projects.getProject(S, projectId))?.ownerId).toBe(ERASED_ACTOR_ID);
		expect((await data.definitions.get(S, guid))?.ownerId).toBe(ERASED_ACTOR_ID);
		const versions = await data.definitions.listVersions(S, guid);
		expect(versions.items[0].uploadedBy).toBe(ERASED_ACTOR_ID);
	});

	it('runs with no email, for a user who had none', async () => {
		await expect(data.onUserDeleted(S, leaver)).resolves.toBeUndefined();
		expect(await diskContents()).not.toContain(leaver);
	});
});

describe('deleteOrg', () => {
	it('soft-deletes the definitions in its projects', async () => {
		await data.orgs.deleteOrg(S, orgId);
		expect(await data.definitions.get(S, guid)).toBeNull();
	});
});
