/**
 * Tests for `createDefinitionLoader` (K4) — version resolution, error
 * classification, and the ADR 0005 schema-staleness behavior: a cached schema
 * is used only at the app's current format version; anything else re-extracts
 * from compute and persists back (best-effort, current-version only).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';
import type {
	ComputeServerConfig,
	DefinitionRecord,
	DefinitionVersion,
	RequestContext
} from '@selvajs/platform';
import { createDefinitionLoader, DefinitionLoadError } from '../load-for-render.js';

const ctx = { userId: 'user-1' } as RequestContext;

function uiSchema(version: string, inputs: unknown[] = []): UISchema {
	return {
		id: 'schema-1',
		name: 'Test',
		schemaVersion: version,
		inputs,
		outputs: [],
		layout: { type: 'tabbed', tabs: [] }
	} as unknown as UISchema;
}

const record = {
	guid: 'def-1',
	projectId: 'proj-1',
	computeServerId: null,
	liveVersionId: 'v-live',
	draftVersionId: 'v-draft'
} as unknown as DefinitionRecord;

function version(overrides: Partial<DefinitionVersion> = {}): DefinitionVersion {
	return {
		id: 'v-live',
		definitionId: 'def-1',
		versionNumber: 1,
		fileExt: 'gh',
		fileKey: 'definitions/def-1/versions/v1.gh',
		uploadedBy: 'user-1',
		uploadedAt: '2026-07-01T00:00:00Z',
		...overrides
	} as DefinitionVersion;
}

const computeServer = { id: 'srv-1', serverUrl: 'http://c.example' } as ComputeServerConfig;

function makeDeps(overrides: Record<string, unknown> = {}) {
	const getIO = vi.fn(async () => ({ inputs: [{ id: 'a', default: 42 }], outputs: [] }));
	const deps = {
		storage: { get: vi.fn(async () => new Uint8Array([1, 2, 3])) },
		definitions: {
			getVersion: vi.fn(async () => version()),
			setVersionSchema: vi.fn(async () => {})
		},
		projects: { getProject: vi.fn(async () => ({ id: 'proj-1', orgId: 'org-1' })) },
		resolveServer: vi.fn(async () => computeServer),
		getClient: vi.fn(async () => ({ client: { getIO, getRawIO: vi.fn() } })),
		fetchSchema: vi.fn(async () => uiSchema(UI_SCHEMA_VERSION, [{ id: 'a' }])),
		onWarn: vi.fn(),
		...overrides
	};
	return {
		deps: deps as never as Parameters<typeof createDefinitionLoader>[0],
		mocks: deps,
		getIO
	};
}

async function flushMicrotasks() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('schema cache staleness (ADR 0005)', () => {
	it('uses the cached schema when its version matches, without re-extracting or persisting', async () => {
		const cached = uiSchema(UI_SCHEMA_VERSION, [{ id: 'a' }]);
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: cached }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live');

		expect(mocks.fetchSchema).not.toHaveBeenCalled();
		expect(mocks.definitions.setVersionSchema).not.toHaveBeenCalled();
		// Compute defaults are merged into the cached schema's inputs.
		expect((result.schema.inputs[0] as { default?: unknown }).default).toBe(42);
	});

	it('re-extracts and persists when the cached schema is at an older format version', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: uiSchema('2.10.0') }));

		await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(mocks.fetchSchema).toHaveBeenCalledTimes(1);
		expect(mocks.definitions.setVersionSchema).toHaveBeenCalledWith(
			ctx,
			'v-live',
			expect.objectContaining({ schemaVersion: UI_SCHEMA_VERSION })
		);
	});

	it('re-extracts and persists when no schema is cached (pre-caching row)', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));

		await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(mocks.fetchSchema).toHaveBeenCalledTimes(1);
		expect(mocks.definitions.setVersionSchema).toHaveBeenCalledTimes(1);
	});

	it('does NOT persist a re-extracted schema that is still not at the current version', async () => {
		// Compute plugin behind the app: re-extraction yields an older format.
		const { deps, mocks } = makeDeps({
			fetchSchema: vi.fn(async () => uiSchema('2.10.0'))
		});
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(mocks.definitions.setVersionSchema).not.toHaveBeenCalled();
		// The older schema still renders (older shapes only lack optional additions).
		expect(result.schema.schemaVersion).toBe('2.10.0');
	});

	it('a failed persist warns but does not fail the render', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));
		mocks.definitions.setVersionSchema.mockRejectedValue(new Error('RLS: not allowed'));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(result.schema.schemaVersion).toBe(UI_SCHEMA_VERSION);
		expect(mocks.onWarn).toHaveBeenCalledWith(expect.stringContaining('cache refresh failed'));
	});
});

describe('version resolution', () => {
	it('resolves the draft pointer for the draft channel', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ id: 'v-draft' }));

		await createDefinitionLoader(deps)(ctx, record, 'draft');
		expect(mocks.definitions.getVersion).toHaveBeenCalledWith(ctx, 'v-draft');
	});

	it('an explicit versionId wins over the channel pointer', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ id: 'v-7' }));

		await createDefinitionLoader(deps)(ctx, record, 'live', 'v-7');
		expect(mocks.definitions.getVersion).toHaveBeenCalledWith(ctx, 'v-7');
	});

	it("rejects a version that belongs to another definition ('data')", async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ definitionId: 'other-def' }));

		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toMatchObject({
			name: 'DefinitionLoadError',
			kind: 'data'
		});
	});
});

describe('error classification', () => {
	it("no pointer for the channel → 'data'", async () => {
		const { deps } = makeDeps();
		const bare = { ...record, liveVersionId: null } as unknown as DefinitionRecord;
		await expect(createDefinitionLoader(deps)(ctx, bare, 'live')).rejects.toMatchObject({
			kind: 'data'
		});
	});

	it("missing blob → 'data'", async () => {
		const { deps, mocks } = makeDeps();
		mocks.storage.get.mockResolvedValue(null as never);
		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toMatchObject({
			kind: 'data'
		});
	});

	it("unresolvable compute server → 'missing-config'", async () => {
		const { deps, mocks } = makeDeps();
		mocks.resolveServer.mockRejectedValue(new Error('none visible'));
		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toMatchObject({
			kind: 'missing-config'
		});
	});

	it("client connect failure → 'connect'", async () => {
		const { deps, mocks } = makeDeps();
		mocks.getClient.mockRejectedValue(new Error('ECONNREFUSED'));
		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toMatchObject({
			kind: 'connect'
		});
	});

	it("IO/schema phase failure → 'schema'", async () => {
		const { deps, mocks } = makeDeps({
			fetchSchema: vi.fn(async () => {
				throw new Error('no Schema output');
			})
		});
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));
		const err = await createDefinitionLoader(deps)(ctx, record, 'live').catch((e) => e);
		expect(err).toBeInstanceOf(DefinitionLoadError);
		expect(err.kind).toBe('schema');
	});
});

describe('compute default merging', () => {
	beforeEach(() => vi.clearAllMocks());

	it('converts Color defaults to hex', async () => {
		const { deps, mocks } = makeDeps({
			getClient: vi.fn(async () => ({
				client: {
					getIO: vi.fn(async () => ({
						inputs: [{ id: 'col', paramType: 'Color', default: '255,128,0' }],
						outputs: []
					})),
					getRawIO: vi.fn()
				}
			}))
		});
		mocks.definitions.getVersion.mockResolvedValue(
			version({ schema: uiSchema(UI_SCHEMA_VERSION, [{ id: 'col' }]) })
		);

		const result = await createDefinitionLoader(deps)(ctx, record, 'live');
		expect((result.schema.inputs[0] as { default?: unknown }).default).toBe('#ff8000');
	});
});
