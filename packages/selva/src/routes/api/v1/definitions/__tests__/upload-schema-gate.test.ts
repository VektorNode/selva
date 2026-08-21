/**
 * Upload schema-validation gate.
 *
 * Every upload must extract + validate the definition's UI schema from
 * Rhino.Compute BEFORE any blob or version row is written. These tests drive
 * the real route handlers with a mocked compute `/grasshopper/schema` endpoint
 * and assert:
 *   - a valid schema is cached on the created version;
 *   - compute failures (unreachable / no valid Schema) reject the request and
 *     persist nothing (no definition record, no version row, no blob).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST as createDefinition } from '../+server.js';

type CreateDefinitionEvent = Parameters<typeof createDefinition>[0];
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	actAs,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { SYSTEM_CONTEXT, type ComputeServerConfig } from '@selvajs/platform';

let tp: TestProviders | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

const SERVER_URL = 'http://compute.test';

async function seedComputeServer(): Promise<void> {
	const server: ComputeServerConfig = {
		id: 'srv-1',
		label: 'Test',
		serverUrl: SERVER_URL,
		scope: 'platform',
		sharedWith: 'all'
	};
	await tp!.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [server], server.id);
}

/**
 * Compute returns `[{ fileName, schemas: [<schema>] }]`. The wrapper keys arrive
 * camelCase from our fork and PascalCase from mcneel branches; `readSchemaResults`
 * reads them case-insensitively, so either shape works here.
 */
function mockComputeSchemaOk(schema: Record<string, unknown>): void {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify([{ fileName: 'def.gh', schemas: [schema] }]), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		})
	);
}

function mockComputeUnreachable(): void {
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
}

function mockComputeNoSchema(): void {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify([{ fileName: 'def.gh', schemas: [] }]), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		})
	);
}

/**
 * `locals` must carry the whole shape `actAs` returns, not just `{ user, ctx }`
 * — the mounted handler builds its deps from `locals.providers`, so a partial
 * fixture fails inside `depsFromConfig` before the handler runs.
 */
function createEvent(
	locals: Awaited<ReturnType<typeof actAs>>,
	form: FormData
): CreateDefinitionEvent {
	return {
		request: new Request('http://test.local/api/definitions', { method: 'POST', body: form }),
		locals,
		params: {},
		url: new URL('http://test.local/api/definitions')
	} as unknown as CreateDefinitionEvent;
}

function uploadForm(projectId: string): FormData {
	const form = new FormData();
	form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'def.gh');
	form.append('displayName', 'My Definition');
	form.append('projectId', projectId);
	return form;
}

/**
 * Accepts either failure shape.
 *
 * The route is mounted, so failures come back as a `Response` carrying the
 * error envelope. It still catches a thrown `HttpError`: the guards throw, and
 * a regression that lets one escape the binding should fail on the status here,
 * not silently pass because nothing was thrown.
 */
async function expectStatus(promise: Response | Promise<Response>, status: number): Promise<void> {
	try {
		const res = await promise;
		expect(res.status).toBe(status);
	} catch (err) {
		expect((err as { status?: number }).status).toBe(status);
	}
}

describe('definition upload — schema validation gate', () => {
	it('caches the extracted schema on the created version', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedComputeServer();
		const locals = await actAs(tp, alice.id);

		const schema = { name: 'Test', inputs: [], outputs: [] };
		mockComputeSchemaOk(schema);

		const res = await createDefinition(createEvent(locals, uploadForm(alicesPrivate.id)));
		const body = (await res.json()) as { guid: string; version: { id: string } };

		const stored = await tp.config.data.definitions.getVersion(locals.ctx, body.version.id);
		expect(stored?.schema).toEqual(schema);
		expect(stored?.schemaExtractedAt).toBeTypeOf('string');
	});

	it('rejects with 503 and persists nothing when compute is unreachable', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedComputeServer();
		const locals = await actAs(tp, alice.id);

		mockComputeUnreachable();

		await expectStatus(createDefinition(createEvent(locals, uploadForm(alicesPrivate.id))), 503);

		// Nothing written: no definition in the project.
		const page = await tp.config.data.definitions.listByProject(locals.ctx, alicesPrivate.id, {
			includePending: true
		});
		expect(page.items).toHaveLength(0);
	});

	it('rejects with 422 when the definition has no valid Schema output', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedComputeServer();
		const locals = await actAs(tp, alice.id);

		mockComputeNoSchema();

		await expectStatus(createDefinition(createEvent(locals, uploadForm(alicesPrivate.id))), 422);

		const page = await tp.config.data.definitions.listByProject(locals.ctx, alicesPrivate.id, {
			includePending: true
		});
		expect(page.items).toHaveLength(0);
	});

	it('rejects with 503 and persists nothing when no compute server is configured', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		// Intentionally NO seedComputeServer() — resolve has nothing to return.
		const locals = await actAs(tp, alice.id);

		// fetch must never be reached; if it is, the test should still fail loudly.
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await expectStatus(createDefinition(createEvent(locals, uploadForm(alicesPrivate.id))), 503);
		expect(fetchSpy).not.toHaveBeenCalled();

		const page = await tp.config.data.definitions.listByProject(locals.ctx, alicesPrivate.id, {
			includePending: true
		});
		expect(page.items).toHaveLength(0);
	});

	it('seedDefinition still produces a version carrying a cached schema', async () => {
		// Guards the fixture path used by the rest of the suite.
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		expect(def.version.schema).toBeDefined();
	});
});
