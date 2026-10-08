import { describe, expect, it } from 'vitest';
import { createMcpServer } from '@selvajs/mcp';
import { buildOpenApiDocument } from '../../api/v1/openapi.js';
import { selvaTools } from '../tools.js';

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
		apiKey: 'selva_k',
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
				Accept: 'application/json, text/event-stream'
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
		JSON.parse(line.slice(5)) as { result: { isError?: boolean; content: { text: string }[] } }
	).result;
}

describe('selva MCP tools', () => {
	it('describes inputs by label, with range and options', async () => {
		const { server } = serve([SCHEMA]);
		const { content } = await call(server, 'selva_describe_definition', { guid: 'g1' });
		expect(content[0].text).toContain('"Width" (id in-w): number, 1 to 50, default 10');
		expect(content[0].text).toContain('one of: "Oak", "Pine"');
	});

	it('solves with values keyed by label, sending the schema inputs along', async () => {
		const { server, sent } = serve([SCHEMA, SOLVED]);
		const { content } = await call(server, 'selva_solve', {
			guid: 'g1',
			values: { Width: 20, Material: 'Oak' }
		});
		expect(sent[1].url).toBe('https://selva.test/api/v1/definitions/g1/solve');
		expect(sent[1].body).toEqual({
			inputs: SCHEMA.inputs,
			values: { 'in-w': 20, 'in-m': 'oak_v2' }
		});
		const text = content[0].text;
		expect(text).toContain('Weight: 12.4');
		expect(text).toContain('Shape: 2 Mesh');
		expect(text).toContain('Warning: 1. Slow component');
		expect(text).toContain('https://selva.test/library/g1');
	});

	it('names the real inputs when the model guesses one', async () => {
		const { server, sent } = serve([SCHEMA]);
		const result = await call(server, 'selva_solve', { guid: 'g1', values: { Depth: 3 } });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'No input named "Depth". Inputs: "Width", "Material".'
		);
		expect(sent).toHaveLength(1);
	});
});
