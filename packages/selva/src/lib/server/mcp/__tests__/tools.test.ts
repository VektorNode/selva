import { describe, expect, it } from 'vitest';
import rhino3dm from 'rhino3dm';
import { createMcpServer } from '@selvajs/mcp';
import { buildOpenApiDocument } from '../../api/v1/openapi.js';
import { grantedActions } from '../server.js';
import { SolveOutput, selvaTools } from '../tools.js';

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

function serve(responses: unknown[]) {
	const sent: { url: string; body?: unknown }[] = [];
	const fetch = (async (url: string, init?: RequestInit) => {
		sent.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
		return new Response(JSON.stringify(responses.shift()), {
			headers: { 'Content-Type': 'application/json' }
		});
	}) as typeof globalThis.fetch;
	const server = createMcpServer({
		name: 'selva',
		version: '0',
		baseUrl: 'https://selva.test',
		fetch,
		openapi: buildOpenApiDocument(),
		tools: selvaTools('https://selva.test')
	});
	return { server, sent };
}

async function call(server: ReturnType<typeof createMcpServer>, name: string, args: unknown) {
	const res = await server.handle(
		new Request('https://selva.test/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: 'Bearer selva_k'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args }
			})
		})
	);
	const line = (await res.text()).split('\n').find((l) => l.startsWith('data:'))!;
	return (
		JSON.parse(line.slice(5)) as {
			result: {
				isError?: boolean;
				content: { text: string }[];
				structuredContent?: Record<string, unknown>;
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
		const { server } = serve([SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { definition: GUID });
		expect(content[0].text).toContain('"Width" (id in-w): number, 1 to 50, default 10');
		expect(content[0].text).toContain('one of: "Oak", "Pine"');
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
		expect(content[0].text).toContain('Files: 1 FileData, files: flat_pattern.dxf');
		expect(content[0].text).not.toContain('QUJD');
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
		const { content } = await call(server, 'selva_list_definitions', {});
		expect(content[0].text).toContain('Fresh (guid a, solvable)');
		expect(content[0].text).toContain('Empty (guid b, no live version, cannot be solved)');
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
		const { server, sent } = serve([page, SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { definition: 'shelf' });
		expect(sent[0].url).toContain('/api/v1/definitions?');
		expect(sent[1].url).toBe(`https://selva.test/api/v1/definitions/${GUID}/schema`);
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

describe('grantedActions', () => {
	const asKey = (scopes: string[]) => ({
		call: async () => ({ userId: 'u', apiToken: { id: 't', scopes } })
	});

	it('counts read as granted by any action, as /api/v1 does', async () => {
		expect((await grantedActions(asKey(['solve:project:p1']))).sort()).toEqual(['read', 'solve']);
		expect(await grantedActions(asKey(['read:all']))).toEqual(['read']);
	});

	it('grants nothing to a caller without a token', async () => {
		expect(await grantedActions({ call: async () => ({ userId: 'u' }) })).toEqual([]);
	});
});
