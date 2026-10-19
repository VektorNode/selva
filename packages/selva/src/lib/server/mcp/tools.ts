/**
 * Selva's MCP tools: find a definition, read its inputs, solve it, read back numbers.
 * No deletes, share links, tokens or admin.
 */

import {
	fromOperation,
	listOutput,
	tool,
	type ToolDefinition,
	type ToolOutput,
	type UntypedApi
} from '@selvajs/mcp';
import {
	getInputItems,
	type InputLayoutItem,
	type SchemaInput,
	type UISchema
} from '@selvajs/schemas';
import type { RhinoModule } from 'rhino3dm';
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
// Definitions by guid or by name
// ============================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Enough for any library a person names definitions in by hand; past it, use a guid.
const NAME_LOOKUP_PAGES = 5;

const definitionArg = z
	.string()
	.describe('A guid from selva_list_definitions, or the exact display name.');

async function resolveDefinition(
	api: UntypedApi,
	definition: string,
	signal: AbortSignal
): Promise<string> {
	if (UUID.test(definition)) return definition;
	const wanted = definition.trim().toLowerCase();
	const matches: DefinitionItem[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < NAME_LOOKUP_PAGES; page++) {
		const res = (await api.call('getDefinitions', {
			query: { limit: 100, cursor },
			signal
		})) as Page<DefinitionItem>;
		matches.push(...res.items.filter((d) => d.displayName.trim().toLowerCase() === wanted));
		cursor = res.nextCursor;
		if (!cursor) break;
	}
	if (matches.length === 1) return matches[0].guid;
	if (!matches.length) {
		throw new Error(
			`No definition is named "${definition}". Call selva_list_definitions and pass a guid.`
		);
	}
	const lines = matches.map((d) => `- ${d.displayName} (guid ${d.guid})`);
	throw new Error(
		[`${matches.length} definitions are named "${definition}"; pass one guid:`, ...lines].join('\n')
	);
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

// Past this many values an output shows its head; the model asks for the rest.
const MAX_SCALARS = 50;

const SCALAR = /^System\.(Double|Single|Int16|Int32|Int64|Decimal|String|Boolean)$/;
const MESH = 'Rhino.Geometry.Mesh';
const FILE = 'Selva.FileIO.FileData';
// Plumbing for the web app, not results: the UI schema the file embeds, and the
// viewer's mesh batch (megabytes at modest sizes). Neither is in `schema.outputs`.
const PLUMBING = new Set(['Selva.Schema.Models.UISchema', 'Selva.Slva.DisplayBatch']);

const isPlumbing = (tree: DataTree) => {
	const items = Object.values(tree.InnerTree ?? {}).flat();
	return items.length > 0 && items.every((i) => PLUMBING.has(i.type));
};

type TreeItem = DataTree['InnerTree'][string][number];

// Loaded on the first solve that returns a mesh: the WASM module is large and
// most tool calls never need it.
let rhino: Promise<RhinoModule | null> | null = null;
function loadRhino(): Promise<RhinoModule | null> {
	rhino ??= import('rhino3dm').then((m) => m.default()).catch(() => null);
	return rhino;
}

// rhino3dm objects live on the WASM heap and are never garbage collected; its
// typings leave out the `delete()` every emscripten binding has.
interface WasmMesh {
	vertices(): { count: number; delete(): void };
	delete(): void;
}

/** Vertices across the mesh items, or null when there are none or rhino3dm can't decode them. */
async function meshVertexCount(items: TreeItem[]): Promise<number | null> {
	const meshes = items.filter((i) => i.type === MESH);
	if (!meshes.length) return null;
	const r = await loadRhino();
	if (!r) return null;
	let total = 0;
	for (const item of meshes) {
		let mesh: WasmMesh | undefined;
		try {
			mesh = r.CommonObject.decode(JSON.parse(item.data)) as unknown as WasmMesh;
			const vertices = mesh.vertices();
			total += vertices.count;
			vertices.delete();
		} catch {
			return null;
		} finally {
			mesh?.delete();
		}
	}
	return total;
}

/** `name.ext` per file item; the payload keys are PascalCase or camelCase depending on the serializer. */
function fileNames(items: TreeItem[]): string[] {
	return items
		.filter((i) => i.type === FILE)
		.map((i) => {
			const f = parseItem(i.data) as Record<string, unknown> | null;
			const name = f?.FileName ?? f?.fileName;
			const ext = f?.FileType ?? f?.fileType;
			return typeof name === 'string' ? name + (typeof ext === 'string' ? ext : '') : 'unnamed';
		});
}

async function summarizeSolve(
	res: SolveResponse,
	schema: UISchema,
	link: string
): Promise<ToolOutput> {
	const lines: string[] = [];
	const structured: Record<string, unknown> = {};
	const declared = new Map(schema.outputs.map((o) => [o.nickname, o.type]));

	for (const tree of res.values ?? []) {
		if (isPlumbing(tree)) continue;
		const items = Object.values(tree.InnerTree ?? {}).flat();
		// Context Print sends numbers as System.String; the schema says what they are.
		const asNumber = declared.get(tree.ParamName) === 'number';
		const scalars = items
			.filter((i) => SCALAR.test(i.type))
			.map((i) => {
				const v = parseItem(i.data);
				return asNumber && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
					? Number(v)
					: v;
			});
		if (items.length && scalars.length === items.length) {
			if (scalars.length > MAX_SCALARS) {
				const head = scalars.slice(0, MAX_SCALARS);
				structured[tree.ParamName] = { count: scalars.length, head };
				lines.push(
					`${tree.ParamName}: ${scalars.length} values, first ${MAX_SCALARS}: ` +
						`${JSON.stringify(head)}. Pass detail: 'full' for all of them.`
				);
				continue;
			}
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
		const vertices = await meshVertexCount(items);
		const files = fileNames(items);
		const parts = [...counts].map(([type, n]) => `${n} ${type}`);
		if (vertices !== null) parts.push(`${vertices.toLocaleString('en-US')} vertices`);
		if (files.length) parts.push(`files: ${files.join(', ')}`);
		structured[tree.ParamName] = {
			geometry: Object.fromEntries(counts),
			...(vertices !== null && { vertices }),
			...(files.length && { files })
		};
		lines.push(`${tree.ParamName}: ${items.length ? parts.join(', ') : 'empty'}`);
	}

	if (!lines.length) lines.push('The solve returned no outputs.');
	if (res.selva?.outcome) lines.push(`Outcome: ${JSON.stringify(res.selva.outcome)}`);
	for (const e of res.errors ?? []) lines.push(`Error: ${e}`);
	for (const w of res.warnings ?? []) lines.push(`Warning: ${w}`);
	lines.push(`Geometry and file contents are not shown here; view them at ${link}`);

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

const ListOutput = z.object({
	items: z.array(z.record(z.string(), z.unknown())),
	nextCursor: z.string().optional()
});

/** `outputs` is keyed by the definition's own output names, so it can't be closed. */
export const SolveOutput = z.object({
	outputs: z.record(z.string(), z.unknown()),
	errors: z.array(z.string()),
	warnings: z.array(z.string()),
	link: z.string(),
	response: z.unknown().optional()
});

// `any`: tools bind different `Args`, and a list of them has no common type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function selvaTools(origin: string): ToolDefinition<any, any>[] {
	const listProjects = fromOperation('getProjects', {
		name: 'selva_list_projects',
		title: 'List projects',
		description:
			'Projects the key can see. Use a project id to narrow selva_list_definitions. Pages with `cursor`.',
		output: ListOutput,
		shape: (body) => {
			const page = body as Page<ProjectItem>;
			return listOutput(page.items, (p) => `- ${p.name} (id ${p.id})`, page.nextCursor);
		}
	});

	const listDefinitions = fromOperation('getDefinitions', {
		name: 'selva_list_definitions',
		title: 'List definitions',
		description:
			'Grasshopper definitions the key can see, newest changes first. Filter by `projectId`. ' +
			'Only definitions with a live version can be solved; each line says which. `status` is not ' +
			"that: a fresh upload has a live version but reads `draft`, so don't filter on it to find " +
			'solvable ones. Then call selva_describe_definition with a guid.',
		output: ListOutput,
		shape: (body) => {
			const page = body as Page<DefinitionItem>;
			return listOutput(
				page.items,
				(d) =>
					`- ${d.displayName} (guid ${d.guid}, ${d.liveVersionId ? 'solvable' : 'no live version, cannot be solved'})` +
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
		input: z.object({ definition: definitionArg }),
		calls: ['getDefinitions', 'getDefinitionsByGuidSchema'],
		async run(api, { definition }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const schema = (await api.call('getDefinitionsByGuidSchema', {
				params: { guid },
				signal
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
			'Inputs left out keep their defaults. Call selva_describe_definition first. ' +
			"`detail: 'full'` adds the raw solve response with geometry and file contents; it can be very large.",
		input: z.object({
			definition: definitionArg,
			values: z
				.record(z.string(), z.unknown())
				.default({})
				.describe(
					'Input values keyed by the names selva_describe_definition lists. Dropdowns take an option name.'
				),
			detail: z.enum(['summary', 'full']).default('summary')
		}),
		output: SolveOutput,
		calls: ['getDefinitions', 'getDefinitionsByGuidSchema', 'postDefinitionsByGuidSolve'],
		async run(api, { definition, values, detail }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
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
			const summary = await summarizeSolve(
				res,
				schema,
				`${origin}/library/${encodeURIComponent(guid)}`
			);
			if (detail !== 'full') return summary;
			const response = { ...res, values: res.values?.filter((t) => !isPlumbing(t)) };
			return { ...summary, structured: { ...summary.structured, response } };
		}
	});

	return [listProjects, listDefinitions, describeDefinition, solve];
}

export const INSTRUCTIONS =
	'Selva runs Grasshopper definitions on Rhino Compute. To answer a design question: find a ' +
	'definition (selva_list_definitions), read its inputs (selva_describe_definition), then solve it ' +
	'(selva_solve) and read the numbers back. Solving spends the owner’s compute budget: confirm ' +
	'with the user before a series of solves.';
