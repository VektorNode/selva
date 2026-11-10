/**
 * Schema-staleness rule under test: a cached schema is used at the app's current
 * format version, or at an older one within the recheck window; anything else
 * re-extracts from compute and persists back, best-effort, unless it is newer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';
import type {
	ComputeServerConfig,
	DefinitionRecord,
	DefinitionVersion,
	RequestContext
} from '@selvajs/platform';
import {
	createDefinitionLoader,
	DefinitionLoadError,
	isUsableCachedSchema,
	OLDER_SCHEMA_RECHECK_MS
} from '../load-for-render.js';

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
		// Cached still means live defaults: getIO's `default: 42` is merged in.
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

	it('persists an older re-extracted schema and warns that the plugin is behind', async () => {
		// The deployed compute plugin is behind the app: every extract comes back old, so
		// dropping it would send each load back to Compute.
		const { deps, mocks } = makeDeps({
			fetchSchema: vi.fn(async () => uiSchema('2.10.0'))
		});
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(mocks.definitions.setVersionSchema).toHaveBeenCalledWith(
			ctx,
			'v-live',
			expect.objectContaining({ schemaVersion: '2.10.0' })
		);
		expect(mocks.onWarn).toHaveBeenCalledWith(expect.stringContaining('Update the plugin'));
		expect(result.schema.schemaVersion).toBe('2.10.0');
	});

	it('serves an older extract from memory when the persist never lands', async () => {
		// Viewer context under RLS: the write "succeeds" but the row keeps no schema.
		const { deps, mocks } = makeDeps({
			fetchSchema: vi.fn(async () => uiSchema('2.10.0'))
		});
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));
		const load = createDefinitionLoader(deps);

		await load(ctx, record, 'live');
		await load(ctx, record, 'live');
		await load(ctx, record, 'live', null, { skipComputeDefaults: true });

		expect(mocks.fetchSchema).toHaveBeenCalledTimes(1);
		expect(mocks.onWarn).toHaveBeenCalledTimes(1);
	});

	it('serves an older schema extracted within the recheck window without asking Compute', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(
			version({ schema: uiSchema('2.10.0'), schemaExtractedAt: new Date().toISOString() })
		);

		await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(mocks.fetchSchema).not.toHaveBeenCalled();
		expect(mocks.definitions.setVersionSchema).not.toHaveBeenCalled();
	});

	it('asks Compute again for an older schema past the recheck window', async () => {
		const { deps, mocks } = makeDeps();
		const old = new Date(Date.now() - OLDER_SCHEMA_RECHECK_MS - 1000).toISOString();
		mocks.definitions.getVersion.mockResolvedValue(
			version({ schema: uiSchema('2.10.0'), schemaExtractedAt: old })
		);

		await createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();

		expect(mocks.fetchSchema).toHaveBeenCalledTimes(1);
		expect(mocks.definitions.setVersionSchema).toHaveBeenCalledWith(
			ctx,
			'v-live',
			expect.objectContaining({ schemaVersion: UI_SCHEMA_VERSION })
		);
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

describe('isUsableCachedSchema', () => {
	const now = Date.parse('2026-11-10T12:00:00Z');
	const recent = '2026-11-10T11:00:00Z';

	it('takes the current version with or without an extraction time', () => {
		expect(isUsableCachedSchema(uiSchema(UI_SCHEMA_VERSION))).toBe(true);
		expect(isUsableCachedSchema(uiSchema(UI_SCHEMA_VERSION), recent, now)).toBe(true);
	});

	it('takes an older version only with a recent extraction time', () => {
		expect(isUsableCachedSchema(uiSchema('2.10.0'))).toBe(false);
		expect(isUsableCachedSchema(uiSchema('2.10.0'), recent, now)).toBe(true);
		expect(isUsableCachedSchema(uiSchema('2.10.0'), '2026-11-08T00:00:00Z', now)).toBe(false);
	});

	it('treats a missing version (pre-2.12.0 plugin) as older', () => {
		const unversioned = { ...uiSchema('x'), schemaVersion: undefined } as unknown as UISchema;
		expect(isUsableCachedSchema(unversioned)).toBe(false);
		expect(isUsableCachedSchema(unversioned, recent, now)).toBe(true);
	});

	it('expires a future-dated extraction time too', () => {
		expect(isUsableCachedSchema(uiSchema('2.10.0'), '2026-11-10T13:00:00Z', now)).toBe(true);
		expect(isUsableCachedSchema(uiSchema('2.10.0'), '2026-11-20T00:00:00Z', now)).toBe(false);
	});

	it('never takes a PascalCase, unreadable or newer schema', () => {
		const pascal = { SchemaVersion: '2.10.0', Inputs: [] } as unknown as UISchema;
		expect(isUsableCachedSchema(pascal, recent, now)).toBe(false);
		expect(isUsableCachedSchema(uiSchema('next'), recent, now)).toBe(false);
		expect(isUsableCachedSchema(uiSchema('99.0.0'), recent, now)).toBe(false);
	});
});

describe('skipComputeDefaults', () => {
	it('returns the cached schema without connecting to compute at all', async () => {
		const cached = uiSchema(UI_SCHEMA_VERSION, [{ id: 'a' }]);
		const { deps, mocks, getIO } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: cached }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live', null, {
			skipComputeDefaults: true
		});

		// The connect is the cost this option exists to avoid, not just the getIO.
		expect(mocks.getClient).not.toHaveBeenCalled();
		expect(getIO).not.toHaveBeenCalled();
		expect(mocks.fetchSchema).not.toHaveBeenCalled();
		expect(result.schema).toBe(cached);
	});

	it('still returns version/source/server so the shape matches the full path', async () => {
		const cached = uiSchema(UI_SCHEMA_VERSION, [{ id: 'a' }]);
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: cached }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live', null, {
			skipComputeDefaults: true
		});

		expect(result.version.id).toBe('v-live');
		expect(result.computeServer).toBe(computeServer);
		expect(result.definitionSource).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('leaves defaults UNMERGED — the caller opted out of them', async () => {
		const cached = uiSchema(UI_SCHEMA_VERSION, [{ id: 'a' }]);
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: cached }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live', null, {
			skipComputeDefaults: true
		});

		// The full path would have merged getIO's `default: 42` onto input 'a'.
		expect(result.schema.inputs[0]).not.toHaveProperty('default');
	});

	it('falls back to the full path when the version has no cached schema', async () => {
		const { deps, mocks, getIO } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live', null, {
			skipComputeDefaults: true
		});

		expect(mocks.fetchSchema).toHaveBeenCalled();
		expect(getIO).toHaveBeenCalled();
		expect(result.schema.inputs[0]).toMatchObject({ default: 42 });
	});

	it('falls back to the full path when the cached schema format is stale', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(
			version({ schema: uiSchema('0.0.1', [{ id: 'a' }]) })
		);

		await createDefinitionLoader(deps)(ctx, record, 'live', null, {
			skipComputeDefaults: true
		});

		expect(mocks.fetchSchema).toHaveBeenCalled();
	});

	it('does not change behavior when the option is omitted', async () => {
		const cached = uiSchema(UI_SCHEMA_VERSION, [{ id: 'a' }]);
		const { deps, mocks, getIO } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: cached }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live');

		expect(mocks.getClient).toHaveBeenCalled();
		expect(getIO).toHaveBeenCalled();
		expect(result.schema.inputs[0]).toMatchObject({ default: 42 });
	});
});

/**
 * A schema with no readable `inputs` used to reach `mergeComputeDefaults` and
 * die on `schema.inputs.map(...)`, surfacing as a bare "Cannot read properties of
 * undefined (reading 'map')" attributed to an unrelated line. The shape came from
 * a compute server emitting PascalCase (see `assertCamelCaseSchema`).
 */
describe('schema shapes that lack a readable inputs array', () => {
	const pascalCase = {
		Id: 'schema-1',
		SchemaVersion: UI_SCHEMA_VERSION,
		Inputs: [{ Id: 'a' }],
		Outputs: [],
		Layout: { Type: 'tabbed', Tabs: [] }
	} as unknown as UISchema;

	it('reports a classified error rather than throwing on undefined', async () => {
		const { deps, mocks } = makeDeps({ fetchSchema: vi.fn(async () => pascalCase) });
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));

		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toMatchObject({
			name: 'DefinitionLoadError',
			kind: 'schema'
		});
	});

	it('names the missing key instead of surfacing a map() TypeError', async () => {
		const { deps, mocks } = makeDeps({ fetchSchema: vi.fn(async () => pascalCase) });
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: undefined }));

		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toThrow(/inputs/);
	});

	// Without this, a row cached during a PascalCase window is served forever —
	// the version matches, so the staleness check alone would accept it.
	it('re-extracts rather than serving a cached schema with no inputs array', async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(version({ schema: pascalCase }));

		const result = await createDefinitionLoader(deps)(ctx, record, 'live', null, {
			skipComputeDefaults: true
		});

		expect(mocks.fetchSchema).toHaveBeenCalled();
		expect(result.schema.inputs[0]).toMatchObject({ id: 'a' });
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

describe('read order', () => {
	it('resolves the compute server while the version is still being read', async () => {
		const { deps, mocks } = makeDeps();
		let answer: (v: DefinitionVersion) => void = () => {};
		mocks.definitions.getVersion.mockImplementation(
			() => new Promise<DefinitionVersion>((resolve) => (answer = resolve))
		);

		const pending = createDefinitionLoader(deps)(ctx, record, 'live');
		await flushMicrotasks();
		expect(mocks.resolveServer).toHaveBeenCalled();

		answer(version());
		await expect(pending).resolves.toMatchObject({ computeServer });
	});

	it("reports a missing version as 'data' even when no server is configured", async () => {
		const { deps, mocks } = makeDeps();
		mocks.definitions.getVersion.mockResolvedValue(null as never);
		mocks.resolveServer.mockRejectedValue(new Error('no server'));

		await expect(createDefinitionLoader(deps)(ctx, record, 'live')).rejects.toMatchObject({
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
