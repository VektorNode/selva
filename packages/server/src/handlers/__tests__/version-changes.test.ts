/**
 * Version check, upload diff and compare: what a new version changes, against what.
 *
 * Drives the real handlers with Compute's `/grasshopper/schema` mocked, as
 * upload-schema-gate.test.ts does. The seeded v1 has an empty schema.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	seedAcme,
	seedDefinition,
	seedProjectMember,
	actAs,
	callHandler
} from '../../testing/index.js';
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

function mockSchema(schema: Record<string, unknown>, inventory?: unknown): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () =>
			new Response(JSON.stringify([{ fileName: 'def.gh', schemas: [schema], inventory }]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
	);
}

function inventory(opts: { charts?: 'missing' | 'loaded'; gap?: string } = {}) {
	return {
		extractedWith: '1.0.0.0',
		libraries: opts.charts
			? [
					{
						id: '2e872be7-90c2-496a-b80c-f2623c249347',
						name: 'Charts',
						author: 'VN',
						version: '1.3',
						core: false,
						...(opts.charts === 'loaded' && { serverVersion: '1.3' })
					}
				]
			: [],
		components: [{ id: 'c1', type: 't', name: 'Loft', obsolete: false }],
		values: [
			{ id: 's1', kind: 'slider', label: 'Gap', text: opts.gap ?? '1', sha256: opts.gap ?? '1' }
		],
		scripts: [],
		wires: { count: 0, sha256: '' }
	};
}

async function setup() {
	tp = await freshHarness();
	const { alice, bob, alicesPrivate } = await seedAcme(tp);
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
	return { def, locals, bob, guid: def.record.guid };
}

function form(note?: string, acceptMissingPlugins = false): FormData {
	const f = new FormData();
	f.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'def.gh');
	if (note !== undefined) f.append('changeNote', note);
	if (acceptMissingPlugins) f.append('acceptMissingPlugins', 'true');
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

	it('leaves defaults out of the changes when the saved values were not read', async () => {
		const { locals, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [width], outputs: [] });
		await callHandler(uploadVersion, { locals, params: { guid }, body: form() });

		const { default: _unsaved, ...embedded } = width;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
			String(url).endsWith('/io')
				? new Response('boom', { status: 500 })
				: new Response(
						JSON.stringify([
							{ fileName: 'def.gh', schemas: [{ name: 'Test', inputs: [embedded], outputs: [] }] }
						]),
						{ status: 200, headers: { 'Content-Type': 'application/json' } }
					)
		);
		const unread = new FormData();
		unread.append('file', new Blob([new Uint8Array([9, 9])]), 'def.gh');

		const res = await callHandler(checkVersion, { locals, params: { guid }, body: unread });

		const body = res.json as Changes & { defaultsPending: boolean };
		expect(body.defaultsPending).toBe(true);
		expect(body.changes?.changes).toEqual([]);
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
		expect(res.json).toEqual({ base: null, changes: null, inventory: null });
	});
});

describe('inventory', () => {
	it('blocks a file whose plugin the server lacks, unless the uploader accepts it', async () => {
		const { locals, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [], outputs: [] }, inventory({ charts: 'missing' }));

		const check = await callHandler(checkVersion, { locals, params: { guid }, body: form() });
		expect((check.json as { inventory: { warnings: unknown[] } }).inventory.warnings).toEqual([
			{ kind: 'missingPlugin', plugin: 'Charts', version: '1.3' }
		]);

		const refused = await callHandler(uploadVersion, { locals, params: { guid }, body: form() });
		expect(refused.status).toBe(422);
		expect((await tp!.config.data.definitions.listVersions(locals.ctx, guid)).items).toHaveLength(
			1
		);

		const accepted = await callHandler(uploadVersion, {
			locals,
			params: { guid },
			body: form(undefined, true)
		});
		expect(accepted.status).toBe(201);
		const listed = (await tp!.config.data.definitions.listVersions(locals.ctx, guid)).items[0];
		expect(listed.inventorySummary).toEqual({ missingPlugins: ['Charts'], obsoleteComponents: 0 });
		expect(listed.inventory).toBeUndefined();
	});

	it('says what changed inside, to editors only', async () => {
		const { def, locals, bob, guid } = await setup();
		mockSchema({ name: 'Test', inputs: [], outputs: [] }, inventory({ charts: 'loaded' }));
		await callHandler(uploadVersion, { locals, params: { guid }, body: form() });
		mockSchema(
			{ name: 'Test', inputs: [], outputs: [] },
			inventory({ charts: 'loaded', gap: '2' })
		);
		const up = await callHandler(uploadVersion, { locals, params: { guid }, body: form() });
		const v3 = (up.json as { version: { id: string } }).version.id;

		const res = await callHandler(getVersionChanges, { locals, params: { guid, versionId: v3 } });
		const body = res.json as { inventory: { diff: { values: unknown[] }; missing: null } };
		expect(body.inventory.missing).toBeNull();
		expect(body.inventory.diff.values).toMatchObject([{ label: 'Gap', before: '1', after: '2' }]);

		// The seeded v1 predates inventories: the compare names the side that has none.
		const old = await callHandler(getVersionChanges, {
			locals,
			params: { guid, versionId: v3 },
			url: `http://test.local/x?against=${def.version.id}`
		});
		expect((old.json as { inventory: { missing: string } }).inventory.missing).toBe('base');

		await seedProjectMember(tp!, {
			projectId: def.record.projectId,
			userId: bob.id,
			role: 'viewer'
		});
		const viewer = await callHandler(getVersionChanges, {
			locals: await actAs(tp!, bob.id),
			params: { guid, versionId: v3 }
		});
		expect(viewer.status).toBe(200);
		expect(viewer.json).not.toHaveProperty('inventory');
	});
});
