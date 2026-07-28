/**
 * Tests for `DefinitionService.uploadVersion` version-number allocation (caching
 * Phase 1.5). The root-cause fix: the next version number comes from the store's
 * monotonic `reserveNextVersionNumber` counter — NOT max(existing)+1, which
 * reused a number (and its `fileKey`) after delete-latest and let a stale storage
 * blob serve the old version's bytes for new content.
 *
 * These run against fakes that record the store/storage calls, so they pin the
 * SERVICE's contract (reserve → derive fileKey from the reserved number). That a
 * real provider's counter is truly monotonic across delete-then-reupload is
 * covered by the definition-store conformance suite (both providers).
 */

import { describe, it, expect } from 'vitest';
import type {
	IDataProvider,
	IStorageProvider,
	RequestContext,
	DefinitionRecord,
	DefinitionVersion,
	UISchema
} from '@selvajs/platform';
import { DefinitionService } from '../definition-service.js';

const CTX = { userId: 'u-1' } as RequestContext;
const SCHEMA = {} as UISchema;

function fakeRecord(guid: string, nextVersionNumber: number): DefinitionRecord {
	const now = new Date().toISOString();
	return {
		guid,
		projectId: 'p-1',
		ownerId: 'u-1',
		createdBy: 'u-1',
		updatedBy: 'u-1',
		displayName: 'Def',
		status: 'draft',
		solveCount: 0,
		nextVersionNumber,
		liveVersionId: 'v-existing',
		draftVersionId: 'v-existing',
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
}

/**
 * A minimal data provider whose `definitions` store hands out the reserved
 * number and records the version row it was told to create. Only the methods
 * `uploadVersion` touches are implemented.
 */
function fakeDeps(record: DefinitionRecord) {
	let counter = record.nextVersionNumber;
	const created: DefinitionVersion[] = [];
	const puts: string[] = [];

	const data = {
		definitions: {
			get: async () => record,
			reserveNextVersionNumber: async () => counter++, // monotonic, never reused
			createVersion: async (_ctx: RequestContext, v: DefinitionVersion) => {
				created.push(v);
			},
			setDraftVersion: async () => {}
		}
	} as unknown as IDataProvider;

	const storage = {
		put: async (key: string) => {
			puts.push(key);
		}
	} as unknown as IStorageProvider;

	return { data, storage, created, puts };
}

describe('DefinitionService.uploadVersion — version-number allocation', () => {
	it('reserves the next number from the record counter and derives the fileKey from it', async () => {
		const record = fakeRecord('11111111-1111-1111-1111-111111111111', 3);
		const { data, storage, created, puts } = fakeDeps(record);
		const svc = new DefinitionService(data, storage);

		const version = await svc.uploadVersion(
			CTX,
			record.guid,
			new Uint8Array([1, 2, 3]),
			'gh',
			'model.gh',
			SCHEMA
		);

		expect(version.versionNumber).toBe(3);
		// fileKey encodes the reserved number — so a fresh number ⇒ fresh key.
		expect(version.fileKey).toContain('v3');
		expect(puts).toEqual([version.fileKey]);
		expect(created).toHaveLength(1);
		expect(created[0].versionNumber).toBe(3);
	});

	it('two consecutive uploads mint distinct numbers and distinct fileKeys', async () => {
		const record = fakeRecord('22222222-2222-2222-2222-222222222222', 5);
		const { data, storage } = fakeDeps(record);
		const svc = new DefinitionService(data, storage);

		const a = await svc.uploadVersion(CTX, record.guid, new Uint8Array([1]), 'gh', 'a.gh', SCHEMA);
		const b = await svc.uploadVersion(CTX, record.guid, new Uint8Array([2]), 'gh', 'b.gh', SCHEMA);

		expect(a.versionNumber).toBe(5);
		expect(b.versionNumber).toBe(6);
		expect(a.fileKey).not.toBe(b.fileKey);
	});

	it('does NOT derive the number from the version list (no listVersions call)', async () => {
		// The old bug read the version list; the fix must not. A deps object with no
		// listVersions still works — reserveNextVersionNumber is the only source.
		const record = fakeRecord('33333333-3333-3333-3333-333333333333', 9);
		const { data, storage } = fakeDeps(record);
		const svc = new DefinitionService(data, storage);

		const version = await svc.uploadVersion(
			CTX,
			record.guid,
			new Uint8Array([1]),
			'gh',
			'a.gh',
			SCHEMA
		);
		expect(version.versionNumber).toBe(9);
	});
});
