/**
 * Selva's MCP tools: find a definition, read its inputs, solve it, read back numbers.
 * No deletes, share links, tokens or admin.
 */

import {
	fromOperation,
	listOutput,
	tool,
	type ToolDefinition,
	type ToolOutput
} from '@selvajs/mcp';
import {
	getInputItems,
	type InputLayoutItem,
	type SchemaInput,
	type UISchema
} from '@selvajs/schemas';
import { z } from 'zod';

interface DefinitionItem {
	guid: string;
	displayName: string;
	description?: string;
	status: string;
	projectId: string;
	liveVersionId: string | null;
}

interface ProjectItem {
	id: string;
	name: string;
	description?: string;
}

interface Page<T> {
	items: T[];
	nextCursor?: string;
}

/** One output of a solve: a Grasshopper data tree, every item a JSON-encoded string. */
interface DataTree {
	ParamName: string;
	InnerTree: Record<string, { type: string; data: string }[]>;
}

interface SolveResponse {
	values?: DataTree[];
	errors?: string[];
	warnings?: string[];
	selva?: { outcome?: unknown } | null;
}

// ============================================================================
// Inputs: the schema joined with its layout
// ============================================================================

interface DescribedInput {
	input: SchemaInput;
	item?: InputLayoutItem;
	label: string;
}

function describeInputs(schema: UISchema): DescribedInput[] {
	const items = getInputItems(schema);
	return schema.inputs.map((input) => {
		const item = items.find((i) => i.paramId === input.id);
		return { input, item, label: item?.displayName || input.nickname };
	});
}

function optionsOf(item?: InputLayoutItem): Record<string, string | undefined> | undefined {
	if (!item) return undefined;
	if (item.widgetType === 'dropdown') return item.config?.options;
	if (item.widgetType === 'dynamicValueList') return item.config?.defaultOptions;
	return undefined;
}

function inputLine({ input, item, label }: DescribedInput): string {
	const parts = [`- "${label}" (id ${input.id}): ${input.paramType}`];
	if (input.inputStructure && input.inputStructure !== 'item')
		parts.push(`, ${input.inputStructure} of them`);
	if (item?.widgetType === 'number') {
		const { minimum, maximum, stepSize } = item.config ?? {};
		if (minimum !== undefined || maximum !== undefined)
			parts.push(`, ${minimum ?? '…'} to ${maximum ?? '…'}`);
		if (stepSize !== undefined) parts.push(`, step ${stepSize}`);
	}
	const options = optionsOf(item);
	if (options)
		parts.push(
			`, one of: ${Object.keys(options)
				.map((k) => `"${k}"`)
				.join(', ')}`
		);
	if (input.default !== undefined) parts.push(`, default ${JSON.stringify(input.default)}`);
	const description = item?.description || input.description;
	if (description) parts.push(`. ${description}`);
	return parts.join('');
}

/** Values keyed by what the model saw: label, nickname or id. Dropdown labels become their values. */
function resolveValues(
	described: DescribedInput[],
	given: Record<string, unknown>
): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	const unknown: string[] = [];
	for (const [key, value] of Object.entries(given)) {
		const match = described.find(
			(d) => d.input.id === key || d.label === key || d.input.nickname === key
		);
		if (!match) {
			unknown.push(key);
			continue;
		}
		const options = optionsOf(match.item);
		const pick = (v: unknown) =>
			typeof v === 'string' && options?.[v] !== undefined ? options[v] : v;
		values[match.input.id] = Array.isArray(value) ? value.map(pick) : pick(value);
	}
	if (unknown.length) {
		const known = described.map((d) => `"${d.label}"`).join(', ');
		throw new Error(`No input named ${unknown.map((k) => `"${k}"`).join(', ')}. Inputs: ${known}.`);
	}
	return values;
}

// ============================================================================
// Outputs: numbers and text for the model, geometry as a count
// ============================================================================

const SCALAR = /^System\.(Double|Single|Int16|Int32|Int64|Decimal|String|Boolean)$/;

function summarizeSolve(res: SolveResponse, link: string): ToolOutput {
	const lines: string[] = [];
	const structured: Record<string, unknown> = {};

	for (const tree of res.values ?? []) {
		const items = Object.values(tree.InnerTree ?? {}).flat();
		const scalars = items.filter((i) => SCALAR.test(i.type)).map((i) => parseItem(i.data));
		if (items.length && scalars.length === items.length) {
			const value = scalars.length === 1 ? scalars[0] : scalars;
			structured[tree.ParamName] = value;
			lines.push(`${tree.ParamName}: ${JSON.stringify(value)}`);
			continue;
		}
		const counts = new Map<string, number>();
		for (const i of items) {
			const name = i.type.split('.').pop() ?? i.type;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		const summary = items.length
			? [...counts].map(([type, n]) => `${n} ${type}`).join(', ')
			: 'empty';
		structured[tree.ParamName] = { geometry: Object.fromEntries(counts) };
		lines.push(`${tree.ParamName}: ${summary}`);
	}

	if (!lines.length) lines.push('The solve returned no outputs.');
	if (res.selva?.outcome) lines.push(`Outcome: ${JSON.stringify(res.selva.outcome)}`);
	for (const e of res.errors ?? []) lines.push(`Error: ${e}`);
	for (const w of res.warnings ?? []) lines.push(`Warning: ${w}`);
	lines.push(`Geometry is not shown here; view it at ${link}`);

	return {
		text: lines.join('\n'),
		structured: {
			outputs: structured,
			errors: res.errors ?? [],
			warnings: res.warnings ?? [],
			link
		}
	};
}

function parseItem(data: string): unknown {
	try {
		return JSON.parse(data);
	} catch {
		return data;
	}
}

// ============================================================================
// Tools
// ============================================================================

// `any`: tools bind different `Args`, and a list of them has no common type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function selvaTools(origin: string): ToolDefinition<any, any>[] {
	const listProjects = fromOperation('getProjects', {
		name: 'selva_list_projects',
		title: 'List projects',
		description:
			'Projects the key can see. Use a project id to narrow selva_list_definitions. Pages with `cursor`.',
		shape: (body) => {
			const page = body as Page<ProjectItem>;
			return listOutput(page.items, (p) => `- ${p.name} (id ${p.id})`, page.nextCursor);
		}
	});

	const listDefinitions = fromOperation('getDefinitions', {
		name: 'selva_list_definitions',
		title: 'List definitions',
		description:
			'Grasshopper definitions the key can see, newest changes first. Filter by `projectId` or ' +
			'`status` (`published` ones can be solved). Then call selva_describe_definition with a guid.',
		shape: (body) => {
			const page = body as Page<DefinitionItem>;
			return listOutput(
				page.items,
				(d) =>
					`- ${d.displayName} (guid ${d.guid}, ${d.status}${d.liveVersionId ? '' : ', nothing published'})` +
					(d.description ? `: ${d.description}` : ''),
				page.nextCursor
			);
		}
	});

	const describeDefinition = tool({
		name: 'selva_describe_definition',
		title: 'Describe a definition',
		description:
			"A published definition's inputs (name, type, range, options, default) and outputs. Call " +
			'before selva_solve; pass inputs to it by the quoted name.',
		input: z.object({ guid: z.string().describe('From selva_list_definitions.') }),
		calls: ['getDefinitionsByGuidSchema'],
		async run(api, { guid }) {
			const schema = (await api.call('getDefinitionsByGuidSchema', {
				params: { guid }
			})) as UISchema;
			const lines = [`# ${schema.name}`];
			if (schema.description) lines.push(schema.description);
			lines.push('', 'Inputs:', ...describeInputs(schema).map(inputLine));
			lines.push('', 'Outputs:', ...schema.outputs.map((o) => `- "${o.nickname}": ${o.type}`));
			return lines.join('\n');
		}
	});

	const solve = tool({
		name: 'selva_solve',
		title: 'Solve a definition',
		description:
			'Runs the live version of a definition on Rhino Compute and returns its number and text ' +
			'outputs, with a one-line summary of each geometry output. Spends compute; can take minutes. ' +
			'Inputs left out keep their defaults. Call selva_describe_definition first.',
		input: z.object({
			guid: z.string(),
			values: z
				.record(z.string(), z.unknown())
				.default({})
				.describe(
					'Input values keyed by the names selva_describe_definition lists. Dropdowns take an option name.'
				)
		}),
		calls: ['getDefinitionsByGuidSchema', 'postDefinitionsByGuidSolve'],
		async run(api, { guid, values }, { signal }) {
			const schema = (await api.call('getDefinitionsByGuidSchema', {
				params: { guid },
				signal
			})) as UISchema;
			const res = (await api.call('postDefinitionsByGuidSolve', {
				params: { guid },
				// `inputs` is required: without it the server ignores `values` and solves the file's own.
				body: { inputs: schema.inputs, values: resolveValues(describeInputs(schema), values) },
				signal
			})) as SolveResponse;
			return summarizeSolve(res, `${origin}/library/${encodeURIComponent(guid)}`);
		}
	});

	return [listProjects, listDefinitions, describeDefinition, solve];
}

export const INSTRUCTIONS =
	'Selva runs Grasshopper definitions on Rhino Compute. To answer a design question: find a ' +
	'definition (selva_list_definitions), read its inputs (selva_describe_definition), then solve it ' +
	'(selva_solve) and read the numbers back. Solving spends the owner’s compute budget: confirm ' +
	'with the user before a series of solves.';
