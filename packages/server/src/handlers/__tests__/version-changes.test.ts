/**
 * Version check, upload diff and compare: what a new version changes, against what.
 *
 * Drives the real handlers with Compute's `/grasshopper/schema` mocked, as
 * upload-schema-gate.test.ts does. The seeded v1 has an empty schema.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedDefinition, actAs, callHandler } from '../../testing/index.js';
import { SYSTEM_CONTEXT, type ComputeServerConfig } from '@selvajs/platform';
import { checkVersion, getVersionChanges, uploadVersion } from '../definitionVersions.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

const width = { id: 'w', nickname: 'Width', paramType: 'number', default: 10 };

function mockSchema(schema: Record<string, unknown>): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () =>
			new Response(JSON.stringify([{ fileName: 'def.gh', schemas: [schema] }]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
	);
}

async function setup() {
	tp = await freshHarness();
	const { alice, alicesPrivate } = await seedAcme(tp);
	const server: ComputeServerConfig = {
		id: 'srv-1',
		label: 'Test',
		serverUrl: 'http://compute.test',
		scope: 'platform',
		sharedWith: 'all'
	};
	await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [server], server.id);
	const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	const locals = await actAs(tp, alice.id);
	return { def, locals, guid: def.record.guid };
}

function form(note?: string): FormData {
	const f = new FormData();
	f.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'def.gh');
	if (note !== undefined) f.append('changeNote', note);
	return f;
}

type Changes = {
	base: { versionNumber: number } | null;
	changes: { changes: { change: string; label: string }[] } | null;
};

describe('version check', () => {
	it('reports the schema and its changes against the current version, writing nothing', async () => {
		const { locals, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [width], outputs: [] });

		const res = await callHandler(checkVersion, { locals, params: { guid }, body: form() });

		expect(res.status).toBe(200);
		const body = res.json as Changes & { schema: { inputs: number } };
		expect(body.schema.inputs).toBe(1);
		expect(body.base?.versionNumber).toBe(1);
		expect(body.changes?.changes).toMatchObject([{ change: 'added', label: 'Width' }]);

		const versions = await tp!.config.data.definitions.listVersions(locals.ctx, guid);
		expect(versions.items).toHaveLength(1);
	});

	it('answers a file without a schema the way an upload would, with nothing written', async () => {
		const { locals, guid } = await setup();
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		const res = await callHandler(checkVersion, { locals, params: { guid }, body: form() });

		expect(res.status).toBeGreaterThanOrEqual(400);
		const versions = await tp!.config.data.definitions.listVersions(locals.ctx, guid);
		expect(versions.items).toHaveLength(1);
	});
});

describe('version upload', () => {
	it('returns what the upload changed against the version it follows', async () => {
		const { locals, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [width], outputs: [] });

		const res = await callHandler(uploadVersion, {
			locals,
			params: { guid },
			body: form('## Wider walls\n\n- adds **Width**')
		});

		expect(res.status).toBe(201);
		const body = res.json as Changes & { version: { versionNumber: number; changeNote: string } };
		expect(body.version.versionNumber).toBe(2);
		expect(body.version.changeNote).toBe('## Wider walls\n\n- adds **Width**');
		expect(body.base?.versionNumber).toBe(1);
		expect(body.changes?.changes).toMatchObject([{ change: 'added', label: 'Width' }]);
	});

	it('refuses notes over the limit instead of cutting them', async () => {
		const { locals, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [], outputs: [] });

		const res = await callHandler(uploadVersion, {
			locals,
			params: { guid },
			body: form('x'.repeat(10_001))
		});

		expect(res.status).toBe(400);
	});
});

describe('version changes', () => {
	it('compares with the version before by default, or with ?against', async () => {
		const { def, locals, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [width], outputs: [] });
		const up = await callHandler(uploadVersion, { locals, params: { guid }, body: form() });
		const v2 = (up.json as { version: { id: string } }).version.id;

		const byDefault = await callHandler(getVersionChanges, {
			locals,
			params: { guid, versionId: v2 }
		});
		expect(byDefault.status).toBe(200);
		expect((byDefault.json as Changes).changes?.changes).toMatchObject([{ change: 'added' }]);

		// Reversed: v1 against v2 removes the input.
		const reversed = await callHandler(getVersionChanges, {
			locals,
			params: { guid, versionId: def.version.id },
			url: `http://test.local/x?against=${v2}`
		});
		expect((reversed.json as Changes).changes?.changes).toMatchObject([
			{ change: 'removed', label: 'Width' }
		]);
	});

	it('has no base for the first version', async () => {
		const { def, locals, guid } = await setup();
		const res = await callHandler(getVersionChanges, {
			locals,
			params: { guid, versionId: def.version.id }
		});
		expect(res.json).toEqual({ base: null, changes: null });
	});
});
