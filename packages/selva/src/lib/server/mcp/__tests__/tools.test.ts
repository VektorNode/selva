import { beforeEach, describe, expect, it, vi } from 'vitest';
import rhino3dm from 'rhino3dm';
import { createMcpServer, SOLVE_VIEW_KEY } from '@selvajs/mcp';
import { buildOpenApiDocument } from '../../api/v1/openapi.js';
import { grantedActions } from '../server.js';
import { createStash, type Stash } from '../stash.js';
import { SolveOutput, selvaTools } from '../tools.js';
import { selvaViews } from '../views.js';

const capture = vi.hoisted(() => ({
	run: vi.fn(async (): Promise<{ png: string; pngs: string[]; drawn: number }> => ({
		png: 'iVBO',
		pngs: ['iVBO'],
		drawn: 3
	}))
}));
vi.mock('@selvajs/mcp/capture', async (original) => ({
	...(await original<typeof import('@selvajs/mcp/capture')>()),
	captureSolve: capture.run
}));

const GUID = '3f2c8a1e-6b4d-4e2a-9c1f-0a7b5d8e9f10';

const SCHEMA = {
	id: 's',
	name: 'Shelf',
	schemaVersion: '2.15.0',
	inputs: [
		{ id: 'in-w', nickname: 'W', paramType: 'number', default: 10 },
		{ id: 'in-m', nickname: 'M', paramType: 'valueList' }
	],
	outputs: [{ id: 'out-kg', nickname: 'Weight', type: 'number' }],
	layout: {
		type: 'flat',
		groups: [
			{
				id: 'g',
				items: [
					{
						id: 'l1',
						type: 'input',
						widgetType: 'number',
						paramId: 'in-w',
						displayName: 'Width',
						config: { minimum: 1, maximum: 50 }
					},
					{
						id: 'l2',
						type: 'input',
						widgetType: 'dropdown',
						paramId: 'in-m',
						displayName: 'Material',
						config: { options: { Oak: 'oak_v2', Pine: 'pine_v1' } }
					}
				]
			}
		]
	}
};

const SOLVED = {
	values: [
		{ ParamName: 'Weight', InnerTree: { '{0}': [{ type: 'System.Double', data: '12.4' }] } },
		{
			ParamName: 'Shape',
			InnerTree: {
				'{0}': [
					{ type: 'Rhino.Geometry.Mesh', data: '{}' },
					{ type: 'Rhino.Geometry.Mesh', data: '{}' }
				]
			}
		}
	],
	warnings: ['1. Slow component']
};

/** Storage as the stash uses it, in memory. */
function memoryStorage() {
	const files = new Map<string, Uint8Array>();
	return {
		files,
		get: async (path: string) => files.get(path) ?? null,
		put: async (path: string, data: Uint8Array) => {
			files.set(path, data);
			return path;
		},
		deletePrefix: async (prefix: string) => {
			for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
		}
	};
}

let stash: Stash;
beforeEach(() => {
	stash = createStash(memoryStorage());
});

const RECORD = {
	guid: GUID,
	displayName: 'Shelf',
	status: 'draft',
	projectId: 'p1',
	liveVersion: { id: 'v1', versionNumber: 1 },
	draftVersion: { id: 'v1', versionNumber: 1 }
};

/** Answers each request with the next response: JSON, or a `Response` as it is. */
function serve(responses: unknown[]) {
	const sent: { url: string; method?: string; body?: unknown }[] = [];
	const fetch = (async (url: string, init?: RequestInit) => {
		const body =
			init?.body instanceof FormData
				? init.body
				: init?.body
					? JSON.parse(init.body as string)
					: undefined;
		sent.push({ url, method: init?.method, body });
		const next = responses.shift();
		if (next instanceof Response) return next;
		return new Response(JSON.stringify(next), {
			headers: { 'Content-Type': 'application/json' }
		});
	}) as typeof globalThis.fetch;
	const server = createMcpServer({
		name: 'selva',
		version: '0',
		baseUrl: 'https://selva.test',
		fetch,
		openapi: buildOpenApiDocument(),
		tools: selvaTools('https://selva.test', { stash }),
		resources: selvaViews()
	});
	return { server, sent };
}

/** With `capabilities`, calls as a 2026-07-28 client that declares them; without, as one that declares none. */
async function call(
	server: ReturnType<typeof createMcpServer>,
	name: string,
	args: unknown,
	capabilities?: Record<string, unknown>
) {
	const res = await server.handle(
		new Request('https://selva.test/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: 'Bearer selva_k',
				...(capabilities && {
					'MCP-Protocol-Version': '2026-07-28',
					'Mcp-Method': 'tools/call',
					'Mcp-Name': name
				})
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name,
					arguments: args,
					...(capabilities && {
						_meta: {
							'io.modelcontextprotocol/protocolVersion': '2026-07-28',
							'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
							'io.modelcontextprotocol/clientCapabilities': capabilities
						}
					})
				}
			})
		})
	);
	const text = await res.text();
	const line = text.split('\n').find((l) => l.startsWith('data:'));
	return (
		JSON.parse(line ? line.slice(5) : text) as {
			result: {
				isError?: boolean;
				content: { type: string; text: string; data?: string; mimeType?: string }[];
				structuredContent?: Record<string, unknown>;
				_meta?: Record<string, unknown>;
			};
		}
	).result;
}

/** A Grasshopper output item holding a real mesh with `n` vertices. */
async function meshItem(n: number) {
	const rhino = await rhino3dm();
	const mesh = new rhino.Mesh();
	for (let i = 0; i < n; i++) mesh.vertices().add(i, 0, 0);
	return { type: 'Rhino.Geometry.Mesh', data: JSON.stringify(mesh.encode()) };
}

describe('selva MCP tools', () => {
	it('describes inputs by label, with range and options', async () => {
		const { server } = serve([RECORD, SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { definition: GUID });
		expect(content[0].text).toContain('"Width" (id in-w): number, 1 to 50, default 10');
		expect(content[0].text).toContain('one of: "Oak", "Pine"');
	});

	it('says which version solves, apart from whether the library lists it', async () => {
		const record = { ...RECORD, draftVersion: { id: 'v2', versionNumber: 2 } };
		const { server } = serve([record, SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { definition: GUID });
		expect(content[0].text).toContain('Version 1 is live: solves run it.');
		expect(content[0].text).toContain('Version 2 is uploaded but not live');
		expect(content[0].text).toContain(
			'does not list it until it is published; that does not stop solves'
		);
	});

	it('solves with values keyed by label, sending the schema inputs along', async () => {
		const { server, sent } = serve([SCHEMA, SOLVED]);
		const { content } = await call(server, 'selva_solve', {
			definition: GUID,
			values: { Width: 20, Material: 'Oak' }
		});
		expect(sent[1].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/solve`);
		expect(sent[1].body).toEqual({
			inputs: SCHEMA.inputs,
			values: { 'in-w': 20, 'in-m': 'oak_v2' }
		});
		const text = content[0].text;
		expect(text).toContain('Weight: 12.4');
		expect(text).toContain('Shape: 2 Mesh');
		expect(text).toContain('Warning: 1. Slow component');
		expect(text).toContain(`https://selva.test/library/${GUID}`);
	});

	it('counts vertices across the mesh items it can decode', async () => {
		const shape = {
			ParamName: 'Shape',
			InnerTree: { '{0}': [await meshItem(3), await meshItem(4)] }
		};
		const { server } = serve([SCHEMA, { values: [shape] }]);
		const { content, structuredContent } = await call(server, 'selva_solve', { definition: GUID });
		expect(content[0].text).toContain('Shape: 2 Mesh, 7 vertices');
		expect(structuredContent?.outputs).toEqual({ Shape: { geometry: { Mesh: 2 }, vertices: 7 } });
	});

	it("adds the raw response only with detail: 'full'", async () => {
		const { server } = serve([SCHEMA, SOLVED, SCHEMA, SOLVED]);
		const summary = await call(server, 'selva_solve', { definition: GUID });
		expect(summary.structuredContent).not.toHaveProperty('response');
		const full = await call(server, 'selva_solve', { definition: GUID, detail: 'full' });
		expect(full.structuredContent?.response).toEqual(SOLVED);
		expect(full.content[0].text).toContain('Weight: 12.4');
	});

	it('drops the embedded schema and viewer batch, in the summary and the full response', async () => {
		const plumbing = [
			{
				ParamName: 'Schema',
				InnerTree: { '{0}': [{ type: 'Selva.Schema.Models.UISchema', data: '{}' }] }
			},
			{
				ParamName: 'Display',
				InnerTree: { '{0}': [{ type: 'Selva.Slva.DisplayBatch', data: '"…"' }] }
			}
		];
		const { server } = serve([SCHEMA, { values: [...SOLVED.values, ...plumbing] }]);
		const { content, structuredContent } = await call(server, 'selva_solve', {
			definition: GUID,
			detail: 'full'
		});
		expect(content[0].text).not.toMatch(/UISchema|DisplayBatch|Display:/);
		expect(Object.keys(structuredContent?.outputs as object)).toEqual(['Weight', 'Shape']);
		const response = structuredContent?.response as { values: { ParamName: string }[] };
		expect(response.values.map((v) => v.ParamName)).toEqual(['Weight', 'Shape']);
	});

	it('reads a number output sent as text by the type the schema declares', async () => {
		const printed = {
			ParamName: 'Weight',
			InnerTree: { '{0}': [{ type: 'System.String', data: '"500.7"' }] }
		};
		const { server } = serve([SCHEMA, { values: [printed] }]);
		const { content, structuredContent } = await call(server, 'selva_solve', { definition: GUID });
		expect(content[0].text).toContain('Weight: 500.7');
		expect(structuredContent?.outputs).toEqual({ Weight: 500.7 });
	});

	it('names file outputs without their contents', async () => {
		const file = {
			ParamName: 'Files',
			InnerTree: {
				'{0}': [
					{
						type: 'Selva.FileIO.FileData',
						data: JSON.stringify({ FileName: 'flat_pattern', FileType: '.dxf', Data: 'QUJD' })
					}
				]
			}
		};
		const { server } = serve([SCHEMA, { values: [file] }]);
		const { content } = await call(server, 'selva_solve', { definition: GUID });
		expect(content[0].text).toContain('Files: 1 FileData, files: flat_pattern.dxf (4 B) ');
		expect(content[0].text).not.toContain('QUJD');
	});

	it('links each output file for download, decoded', async () => {
		const file = {
			ParamName: 'Files',
			InnerTree: {
				'{0}': [
					{
						type: 'Selva.FileIO.FileData',
						data: JSON.stringify({
							fileName: 'kitchen-run',
							fileType: '.3dm',
							data: Buffer.from('3dm bytes').toString('base64'),
							isBase64Encoded: true
						})
					}
				]
			}
		};
		const { server } = serve([SCHEMA, { values: [file] }]);
		const { content, structuredContent } = await call(server, 'selva_solve', { definition: GUID });
		const url = /https:\/\/selva\.test\/mcp\/files\/([\w-]+)\/kitchen-run\.3dm/.exec(
			content[0].text
		);
		expect(url).not.toBeNull();
		expect(content[0].text).toContain('expire within the hour');
		const held = await stash.get(url![1], 'file');
		expect(Buffer.from(held!.data).toString()).toBe('3dm bytes');
		expect(structuredContent?.outputs).toMatchObject({
			Files: { files: [{ name: 'kitchen-run.3dm', bytes: 9 }] }
		});
	});

	it('hands the 3D view a token for the geometry, and the view gets the whole response', async () => {
		const { server } = serve([SCHEMA, SOLVED]);
		const result = await call(server, 'selva_solve', { definition: GUID });
		const view = result._meta?.[SOLVE_VIEW_KEY] as {
			title: string;
			load: { tool: string; arguments: { token: string } };
		};
		expect(view.title).toBe('Shelf');
		expect(view.load.tool).toBe('selva_solve_geometry');
		const geometry = await call(server, 'selva_solve_geometry', view.load.arguments);
		expect(geometry._meta?.[SOLVE_VIEW_KEY]).toEqual({ response: SOLVED });
	});

	it('leaves out the 3D view for a client without MCP Apps, and hands out a solve id', async () => {
		const { server } = serve([SCHEMA, SOLVED]);
		const result = await call(server, 'selva_solve', { definition: GUID }, {});
		expect(result.isError).toBeFalsy();
		expect(result._meta?.[SOLVE_VIEW_KEY]).toBeUndefined();
		const solveId = (result.structuredContent as { solveId: string }).solveId;
		expect(result.content[0].text).toContain(`Solve id ${solveId}`);
		expect(await stash.get(solveId, 'solve')).toBeDefined();
	});

	it('hands the view to a client that declares MCP Apps', async () => {
		const { server } = serve([SCHEMA, SOLVED]);
		const result = await call(
			server,
			'selva_solve',
			{ definition: GUID },
			{ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }
		);
		expect(result._meta?.[SOLVE_VIEW_KEY]).toBeDefined();
	});

	it('points at the check tool when a solve reports errors', async () => {
		const { server } = serve([SCHEMA, { values: [], errors: ['Repeat failed to collect data'] }]);
		const { content } = await call(server, 'selva_solve', { definition: GUID });
		expect(content[0].text).toContain('Error: Repeat failed to collect data');
		expect(content[0].text).toContain('selva_check_definition');
	});

	it('marks definitions solvable by live version, not status', async () => {
		const { server } = serve([
			{
				items: [
					{ guid: 'a', displayName: 'Fresh', status: 'draft', projectId: 'p', liveVersionId: 'v1' },
					{ guid: 'b', displayName: 'Empty', status: 'draft', projectId: 'p', liveVersionId: null }
				]
			}
		]);
		const { content, structuredContent } = await call(server, 'selva_list_definitions', {});
		expect(content[0].text).toContain('Fresh (guid a, solvable, not listed in the library)');
		expect(content[0].text).toContain(
			'Empty (guid b, no live version, cannot be solved, not listed in the library)'
		);
		const items = structuredContent?.items as Record<string, unknown>[];
		expect(items[0]).toMatchObject({ solvable: true, listedInLibrary: false });
		expect(items[0]).not.toHaveProperty('status');
	});

	it('finds a definition by its display name', async () => {
		const page = {
			items: [
				{
					guid: 'aaaaaaaa-0000-4000-8000-000000000001',
					displayName: 'Bracket',
					liveVersionId: 'v'
				},
				{ guid: GUID, displayName: 'Shelf', liveVersionId: 'v' }
			]
		};
		const { server, sent } = serve([page, RECORD, SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { definition: 'shelf' });
		expect(sent[0].url).toContain('/api/v1/definitions?');
		expect(sent[2].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/schema`);
		expect(content[0].text).toContain('# Shelf');
	});

	it('lists the candidates when a name matches more than one definition', async () => {
		const page = {
			items: [
				{ guid: 'aaaaaaaa-0000-4000-8000-000000000001', displayName: 'Shelf', liveVersionId: 'v' },
				{ guid: GUID, displayName: 'shelf', liveVersionId: 'v' }
			]
		};
		const { server } = serve([page]);
		const result = await call(server, 'selva_solve', { definition: 'Shelf' });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('2 definitions are named "Shelf"');
		expect(result.content[0].text).toContain(GUID);
	});

	it('names no match, and points at the list tool', async () => {
		const { server } = serve([{ items: [] }]);
		const result = await call(server, 'selva_solve', { definition: 'Desk' });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('No definition is named "Desk"');
		expect(result.content[0].text).toContain('selva_list_definitions');
	});

	it('shows the head of a long output and says how to get the rest', async () => {
		const many = Array.from({ length: 500 }, (_, i) => ({
			type: 'System.Double',
			data: String(i)
		}));
		const res = { values: [{ ParamName: 'Weight', InnerTree: { '{0}': many } }] };
		const { server } = serve([SCHEMA, res]);
		const { content, structuredContent } = await call(server, 'selva_solve', { definition: GUID });
		expect(content[0].text).toContain('Weight: 500 values, first 50: [0,1,2');
		expect(content[0].text).toContain("detail: 'full'");
		expect(structuredContent?.outputs).toEqual({
			Weight: { count: 500, head: Array.from({ length: 50 }, (_, i) => i) }
		});
	});

	it('declares output schemas the results satisfy', async () => {
		const { server } = serve([]);
		const res = await server.handle(
			new Request('https://selva.test/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					Authorization: 'Bearer selva_k'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			})
		);
		const line = (await res.text()).split('\n').find((l) => l.startsWith('data:'))!;
		const tools = (
			JSON.parse(line.slice(5)) as { result: { tools: { name: string; outputSchema?: object }[] } }
		).result.tools;
		const schemas = Object.fromEntries(tools.map((t) => [t.name, t.outputSchema]));
		expect(schemas.selva_list_definitions).toMatchObject({
			properties: { items: { type: 'array' } }
		});
		expect(schemas.selva_solve).toMatchObject({
			required: expect.arrayContaining(['outputs', 'link'])
		});
		expect(
			SolveOutput.safeParse({ outputs: {}, errors: [], warnings: [], link: 'x' }).success
		).toBe(true);
	});

	it('publishes the draft when there is one', async () => {
		const { server, sent } = serve([
			{ ...RECORD, liveVersion: { id: 'v1' }, draftVersion: { id: 'v2' } },
			{ version: { id: 'v2', versionNumber: 2 } }
		]);
		const { content, structuredContent } = await call(server, 'selva_publish_definition', {
			definition: GUID
		});
		expect(sent[1].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/publish`);
		expect(sent[1].body).toEqual({ versionId: 'v2' });
		expect(content[0].text).toContain('Shelf: version 2 is live and the library lists it');
		expect(structuredContent).toMatchObject({ versionId: 'v2', versionNumber: 2 });
	});

	it('republishes the live version when there is no draft, which flips the status', async () => {
		const { server, sent } = serve([
			{ displayName: 'Shelf', liveVersion: { id: 'v1' }, draftVersion: null },
			{ version: { id: 'v1', versionNumber: 1 } }
		]);
		await call(server, 'selva_publish_definition', { definition: GUID });
		expect(sent[1].body).toEqual({ versionId: 'v1' });
	});

	it('publishes the version it is given', async () => {
		const { server, sent } = serve([
			{ displayName: 'Shelf', liveVersion: { id: 'v3' }, draftVersion: null },
			{ version: { id: 'v1', versionNumber: 1 } }
		]);
		await call(server, 'selva_publish_definition', { definition: GUID, versionId: 'v1' });
		expect(sent[1].body).toEqual({ versionId: 'v1' });
	});

	it('says so when there is nothing to publish', async () => {
		const { server, sent } = serve([
			{ displayName: 'Shelf', liveVersion: null, draftVersion: null }
		]);
		const result = await call(server, 'selva_publish_definition', { definition: GUID });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Shelf has no uploaded version to publish.');
		expect(sent).toHaveLength(1);
	});

	it('names the real inputs when the model guesses one', async () => {
		const { server, sent } = serve([SCHEMA]);
		const result = await call(server, 'selva_solve', { definition: GUID, values: { Depth: 3 } });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'No input named "Depth". Inputs: "Width", "Material".'
		);
		expect(sent).toHaveLength(1);
	});
});

describe('selva MCP tools for editors', () => {
	const INVENTORY = {
		warnings: [
			{
				kind: 'unloaded',
				component: 'Repeat',
				plugin: 'Selva',
				version: '0.27.0.0',
				serverVersion: '0.25.0.0',
				count: 1
			}
		],
		plugins: [
			{ name: 'Selva', version: '0.27.0.0', serverVersion: '0.25.0.0' },
			{ name: 'Charts', version: '1.3', serverVersion: null }
		],
		extractedWith: '0.25.0.0'
	};

	it('lists what a definition needs beside what the server has, with the problems', async () => {
		const { server, sent } = serve([RECORD, { base: null, changes: [], inventory: INVENTORY }]);
		const { content, structuredContent } = await call(server, 'selva_check_definition', {
			definition: GUID
		});
		expect(sent[1].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/versions/v1/changes`);
		const text = content[0].text;
		expect(text).toContain('# Shelf, version 1 (live)');
		expect(text).toContain('- Selva: 0.27.0.0 → 0.25.0.0  differs');
		expect(text).toContain('- Charts: 1.3 → not installed  MISSING');
		expect(text).toContain('Repeat (Selva) did not load on the Compute server');
		expect(structuredContent).toMatchObject({ versionId: 'v1', extractedWith: '0.25.0.0' });
	});

	it('says why there is nothing to check', async () => {
		const runner = serve([RECORD, { base: null, changes: [] }]);
		const hidden = await call(runner.server, 'selva_check_definition', { definition: GUID });
		expect(hidden.isError).toBe(true);
		expect(hidden.content[0].text).toContain('Only people who can upload');

		const old = serve([RECORD, { base: null, changes: [], inventory: null }]);
		const none = await call(old.server, 'selva_check_definition', { definition: GUID });
		expect(none.content[0].text).toContain('selva_recheck_definition');
	});

	it('rechecks a version against the server', async () => {
		const { server, sent } = serve([RECORD, { summary: {}, ...INVENTORY }]);
		const { content } = await call(server, 'selva_recheck_definition', { definition: GUID });
		expect(sent[1]).toMatchObject({
			url: `https://selva.test/api/v1/definitions/${GUID}/versions/v1/inventory`,
			method: 'POST'
		});
		expect(content[0].text).toContain('MISSING');
	});

	it('edits details and moves a definition to a project named by the user', async () => {
		const projects = { items: [{ id: 'p2', name: 'Examples' }] };
		const updated = { ...RECORD, category: 'Kitchen', tags: ['demo'], projectId: 'p2' };
		const { server, sent } = serve([projects, new Response(null, { status: 204 }), updated]);
		const { content } = await call(server, 'selva_update_definition', {
			definition: GUID,
			category: 'Kitchen',
			tags: ['demo'],
			description: null,
			project: 'examples'
		});
		expect(sent[1]).toMatchObject({
			url: `https://selva.test/api/v1/definitions/${GUID}`,
			method: 'PATCH',
			body: { category: 'Kitchen', tags: ['demo'], description: null, projectId: 'p2' }
		});
		expect(content[0].text).toContain('Now in project Examples.');
	});

	it('refuses an edit with nothing in it', async () => {
		const { server, sent } = serve([]);
		const result = await call(server, 'selva_update_definition', { definition: GUID });
		expect(result.isError).toBe(true);
		expect(sent).toHaveLength(0);
	});

	it('uploads a held preview as the cover, then shows the stored one', async () => {
		const previewId = await stash.put({
			kind: 'preview',
			name: 'Shelf.png',
			contentType: 'image/png',
			data: new Uint8Array([1, 2, 3])
		});
		const stored = new Response(new Uint8Array([9, 9]), {
			headers: { 'Content-Type': 'image/webp' }
		});
		const { server, sent } = serve([{ coverImage: '/api/files/x' }, stored]);
		const { content } = await call(server, 'selva_set_cover_image', {
			definition: GUID,
			previewId
		});
		expect(sent[0].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/image`);
		const image = (sent[0].body as FormData).get('image') as File;
		expect(image.type).toBe('image/png');
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
		expect(content[1]).toEqual({ type: 'image', data: 'CQk=', mimeType: 'image/webp' });
	});

	it('renders a preview, returns the picture and holds it for the cover', async () => {
		const { server } = serve([SCHEMA, SOLVED]);
		const result = await call(server, 'selva_capture_preview', {
			definition: GUID,
			values: { Width: 20 },
			views: ['top']
		});
		expect(capture.run).toHaveBeenLastCalledWith(
			SOLVED,
			expect.objectContaining({ views: ['top'], width: 1200, height: 800, grid: false })
		);
		expect(result.content[1]).toEqual({ type: 'image', data: 'iVBO', mimeType: 'image/png' });
		const previewId = /top view: preview id ([\w-]+)\./.exec(result.content[0].text)![1];
		expect((await stash.get(previewId, 'preview'))?.contentType).toBe('image/png');
	});

	it('draws a held solve in several views and another look, without solving again', async () => {
		const solved = serve([SCHEMA, SOLVED]);
		const { structuredContent } = await call(solved.server, 'selva_solve', { definition: GUID });
		const solveId = (structuredContent as { solveId: string }).solveId;

		capture.run.mockResolvedValueOnce({ png: 'AAAA', pngs: ['AAAA', 'BBBB'], drawn: 3 });
		const { server, sent } = serve([SCHEMA]);
		const result = await call(server, 'selva_capture_preview', {
			definition: GUID,
			solve: solveId,
			views: ['iso', 'front'],
			look: 'night'
		});
		expect(sent.some((r) => r.url.includes('/solve'))).toBe(false);
		expect(capture.run).toHaveBeenLastCalledWith(
			SOLVED,
			expect.objectContaining({ views: ['iso', 'front'], look: 'night' })
		);
		expect(result.content.slice(1).map((c) => c.data)).toEqual(['AAAA', 'BBBB']);
		expect(result.content[0].text).toMatch(/iso view: preview id .*\n.*front view: preview id/s);
	});

	it('refuses an unknown solve id', async () => {
		const { server } = serve([SCHEMA]);
		const result = await call(server, 'selva_capture_preview', {
			definition: GUID,
			solve: '1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('expired or is unknown');
	});

	it('says when the solve drew nothing, and when the server has no browser', async () => {
		capture.run.mockResolvedValueOnce({ png: '', pngs: [], drawn: 0 });
		const empty = serve([SCHEMA, SOLVED]);
		const nothing = await call(empty.server, 'selva_capture_preview', { definition: GUID });
		expect(nothing.content[0].text).toContain('drew nothing');

		const { CaptureUnavailableError } = await import('@selvajs/mcp/capture');
		capture.run.mockRejectedValueOnce(new CaptureUnavailableError('No browser to render with.'));
		const bare = serve([SCHEMA, SOLVED]);
		const refused = await call(bare.server, 'selva_capture_preview', { definition: GUID });
		expect(refused.isError).toBe(true);
		expect(refused.content[0].text).toContain('No browser to render with.');
	});

	it('wants exactly one image source', async () => {
		const { server } = serve([]);
		const result = await call(server, 'selva_set_cover_image', { definition: GUID });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Pass either previewId or image');
	});

	it('shows the cover as a picture', async () => {
		const stored = new Response(new Uint8Array([7]), { headers: { 'Content-Type': 'image/webp' } });
		const { server } = serve([stored]);
		const { content } = await call(server, 'selva_get_cover_image', { definition: GUID });
		expect(content[1]).toEqual({ type: 'image', data: 'Bw==', mimeType: 'image/webp' });
	});

	it('creates a private project by default', async () => {
		const { server, sent } = serve([{ id: 'p9', name: 'Examples', visibility: 'private' }]);
		const { content } = await call(server, 'selva_create_project', { name: 'Examples' });
		expect(sent[0].body).toEqual({ name: 'Examples', visibility: 'private' });
		expect(content[0].text).toBe('Created Examples (id p9, private).');
	});

	it("lists a project's members across pages", async () => {
		const { server } = serve([
			{ items: [{ id: 'p1', name: 'Examples' }] },
			{
				items: [{ userId: 'u1', role: 'owner', joinedAt: '2026-01-02T00:00:00Z' }],
				nextCursor: 'c'
			},
			{ items: [{ userId: 'u2', role: 'viewer' }] }
		]);
		const { content } = await call(server, 'selva_list_project_members', { project: 'p1' });
		expect(content[0].text).toBe('# Examples\n- u1: owner, since 2026-01-02\n- u2: viewer');
	});
});

describe('selva MCP tools: forms, versions and uploads', () => {
	const FORM_SCHEMA = {
		...SCHEMA,
		inputs: [
			...SCHEMA.inputs,
			{ id: 'in-r', nickname: 'R', paramType: 'number', description: 'Corner radius.' }
		],
		outputs: [
			{ id: 'out-kg', nickname: 'Weight', type: 'number', description: 'Total mass.' },
			{ id: 'out-x', nickname: 'Extra', type: 'text' }
		],
		layout: {
			type: 'flat',
			groups: [
				{
					id: 'g',
					label: 'Size',
					description: 'Outer dimensions of the shelf.',
					items: [
						{
							id: 'l1',
							type: 'input',
							widgetType: 'number',
							paramId: 'in-w',
							displayName: 'Width',
							config: { minimum: 1, maximum: 50, unit: 'cm' }
						},
						{
							id: 'l2',
							type: 'input',
							widgetType: 'dropdown',
							paramId: 'in-m',
							displayName: 'Material',
							config: { options: { Oak: 'oak_v2', Pine: 'pine_v1' } }
						},
						{
							id: 'l3',
							type: 'input',
							widgetType: 'number',
							paramId: 'in-r',
							displayName: 'Radius',
							visibilityCondition: {
								rules: [{ paramId: 'in-m', operator: 'equals', value: 'oak_v2' }]
							}
						},
						{
							id: 'o1',
							type: 'output',
							widgetType: 'number',
							paramId: 'out-kg',
							displayName: 'Mass'
						}
					]
				}
			]
		}
	};

	it('describes the form by group, with units, conditions, descriptions and outputs', async () => {
		const { server } = serve([RECORD, FORM_SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { definition: GUID });
		const text = content[0].text;
		expect(text).toContain('## Size\nOuter dimensions of the shelf.');
		expect(text).toContain('"Width" (id in-w): number, 1 to 50, in cm, default 10');
		expect(text).toContain(
			'"Radius" (id in-r): number, shown only when "Material" is "oak_v2". Corner radius.'
		);
		expect(text).toContain('- "Weight" (shown as Mass): number. Total mass.');
		expect(text).toContain('Other outputs:\n- "Extra": text');
	});

	it("solves the newest upload with version: 'draft'", async () => {
		const record = { ...RECORD, draftVersion: { id: 'v2', versionNumber: 2 } };
		const { server, sent } = serve([record, SCHEMA, SOLVED]);
		await call(server, 'selva_solve', { definition: GUID, version: 'draft' });
		expect(sent[1].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/versions/v2/schema`);
		expect(sent[2].body).toMatchObject({ versionId: 'v2' });
	});

	it('hands the 3D view a form that solves again with the same tool', async () => {
		const { server } = serve([FORM_SCHEMA, SOLVED]);
		const result = await call(server, 'selva_solve', {
			definition: GUID,
			values: { Width: 20 }
		});
		const form = (result._meta?.[SOLVE_VIEW_KEY] as { form: Record<string, unknown> }).form;
		expect(form).toMatchObject({
			tool: 'selva_solve',
			arguments: { definition: GUID },
			valuesKey: 'values'
		});
		expect(form.inputs).toEqual([
			{
				name: 'Width',
				kind: 'number',
				value: 20,
				min: 1,
				max: 50,
				unit: 'cm',
				step: undefined,
				description: undefined
			},
			{
				name: 'Material',
				kind: 'choice',
				options: ['Oak', 'Pine'],
				value: undefined,
				description: undefined
			},
			{
				name: 'Radius',
				kind: 'number',
				value: undefined,
				min: undefined,
				max: undefined,
				step: undefined,
				unit: undefined,
				description: 'Corner radius.'
			}
		]);
	});

	it('lists versions with what is live and what the server lacks', async () => {
		const record = { ...RECORD, draftVersion: { id: 'v2', versionNumber: 2 } };
		const versions = {
			items: [
				{
					id: 'v2',
					versionNumber: 2,
					uploadedAt: '2026-11-18T10:00:00Z',
					changeNote: 'Adds Repeat\nmore',
					inventorySummary: {
						missingPlugins: [],
						unloadedComponents: ['Repeat'],
						obsoleteComponents: 0
					}
				},
				{ id: 'v1', versionNumber: 1, uploadedAt: '2026-11-01T10:00:00Z' }
			]
		};
		const { server } = serve([record, versions]);
		const { content } = await call(server, 'selva_list_versions', { definition: GUID });
		expect(content[0].text).toContain(
			'- version 2 (id v2, 2026-11-18, newest upload, server lacks Repeat): Adds Repeat'
		);
		expect(content[0].text).toContain('- version 1 (id v1, 2026-11-01, live)');
	});

	it('compares a version with the one before, form and inside', async () => {
		const record = { ...RECORD, draftVersion: { id: 'v2', versionNumber: 2 } };
		const changes = {
			base: { id: 'v1', versionNumber: 1 },
			changes: {
				identical: false,
				counts: { breaking: 1, notable: 0, cosmetic: 0 },
				changes: [{ kind: 'input', change: 'removed', impact: 'breaking', label: 'Depth' }]
			},
			inventory: {
				warnings: [],
				diff: {
					plugins: [],
					components: { added: [{ name: 'Repeat', count: 1 }], removed: [] },
					scripts: [],
					values: [],
					wires: { before: 1, after: 2, changed: true },
					identical: false
				}
			}
		};
		const { server, sent } = serve([record, changes]);
		const { content } = await call(server, 'selva_compare_versions', { definition: GUID });
		expect(sent[1].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/versions/v2/changes`);
		expect(content[0].text).toContain('Against version 1:');
		expect(content[0].text).toContain('Removed input **Depth**');
		expect(content[0].text).toContain('Components added: +Repeat');
	});

	it('uploads a version as multipart, and says it is not live yet', async () => {
		const { server, sent } = serve([
			new Response(
				JSON.stringify({
					version: { id: 'v3', versionNumber: 3 },
					base: { id: 'v2', versionNumber: 2 },
					changes: { identical: true, counts: {}, changes: [] },
					inventory: { warnings: [] }
				}),
				{ status: 201, headers: { 'Content-Type': 'application/json' } }
			)
		]);
		const { content } = await call(server, 'selva_upload_version', {
			definition: GUID,
			file: Buffer.from('gh bytes').toString('base64'),
			fileName: 'shelf.gh',
			changeNote: 'Thicker boards'
		});
		const form = sent[0].body as FormData;
		expect(sent[0].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/versions`);
		expect(form.get('changeNote')).toBe('Thicker boards');
		expect(form.get('acceptMissingPlugins')).toBeNull();
		const file = form.get('file') as File;
		expect(file.name).toBe('shelf.gh');
		expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('gh bytes');
		expect(content[0].text).toContain('Uploaded version 3 (id v3). It is not live');
		expect(content[0].text).toContain('The form is the same as in version 2.');
	});

	it('refuses a file that is not a Grasshopper file', async () => {
		const { server, sent } = serve([]);
		const result = await call(server, 'selva_check_upload', {
			definition: GUID,
			file: 'eA==',
			fileName: 'shelf.3dm'
		});
		expect(result.isError).toBe(true);
		expect(sent).toHaveLength(0);
	});

	it('creates a definition in a project named by the user', async () => {
		const { server, sent } = serve([
			{ items: [{ id: 'p2', name: 'Examples' }] },
			new Response(JSON.stringify({ guid: GUID, version: { id: 'v1', versionNumber: 1 } }), {
				status: 201,
				headers: { 'Content-Type': 'application/json' }
			})
		]);
		const { content } = await call(server, 'selva_create_definition', {
			project: 'Examples',
			file: 'eA==',
			fileName: 'kitchen.ghx',
			displayName: 'Kitchen run',
			tags: ['kitchen', 'demo'],
			acceptMissingPlugins: true
		});
		const form = sent[1].body as FormData;
		expect(form.get('projectId')).toBe('p2');
		expect(form.get('tags')).toBe('kitchen,demo');
		expect(form.get('acceptMissingPlugins')).toBe('true');
		expect(content[0].text).toContain('Created Kitchen run (guid');
	});

	it('names project members by display name when they have one', async () => {
		const { server } = serve([
			{ items: [{ id: 'p1', name: 'Examples' }] },
			{
				items: [
					{ userId: 'u1', role: 'owner', displayName: 'Ada' },
					{ userId: 'u2', role: 'viewer', displayName: null }
				]
			}
		]);
		const { content } = await call(server, 'selva_list_project_members', { project: 'p1' });
		expect(content[0].text).toBe('# Examples\n- Ada (u1): owner\n- u2: viewer');
	});
});

describe('grantedActions', () => {
	const asKey = (scopes: string[]) => ({
		call: async () => ({ userId: 'u', apiToken: { id: 't', scopes } })
	});

	it('counts read as granted by any action, as /api/v1 does', async () => {
		expect((await grantedActions(asKey(['solve:project:p1']))).sort()).toEqual(['read', 'solve']);
		expect(await grantedActions(asKey(['read:all']))).toEqual(['read']);
	});

	it('counts upload and create_projects as granted by write, and nothing else by upload', async () => {
		expect((await grantedActions(asKey(['write:all']))).sort()).toEqual([
			'create_projects',
			'read',
			'upload',
			'write'
		]);
		expect((await grantedActions(asKey(['upload:all']))).sort()).toEqual(['read', 'upload']);
	});

	it('grants nothing to a caller without a token', async () => {
		expect(await grantedActions({ call: async () => ({ userId: 'u' }) })).toEqual([]);
	});
});
