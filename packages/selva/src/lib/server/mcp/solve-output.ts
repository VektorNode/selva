import type { ToolOutput } from '@selvajs/mcp';
import { buildFormModel, type UISchema } from '@selvajs/schemas';
import type { RhinoModule } from 'rhino3dm';
import { MCP_FILES_PREFIX } from './path.js';
import type { Stash } from './stash.js';
import { describeInputs } from './form.js';
import { isChartType, isValueListType, readCharts, readValueLists } from './readable-outputs.js';

/** One output of a solve: a Grasshopper data tree, every item a JSON-encoded string. */
export interface DataTree {
	ParamName: string;
	InnerTree: Record<string, { type: string; data: string }[]>;
}

export interface SolveResponse {
	values?: DataTree[];
	errors?: string[];
	warnings?: string[];
	selva?: { outcome?: unknown } | null;
}

type TreeItem = DataTree['InnerTree'][string][number];

// Past this many values an output shows its head; the model asks for the rest.
const MAX_SCALARS = 50;

const SCALAR = /^System\.(Double|Single|Int16|Int32|Int64|Decimal|String|Boolean)$/;
const MESH = 'Rhino.Geometry.Mesh';
const FILE = 'Selva.FileIO.FileData';
// Plumbing for the web app, not results: the UI schema the file embeds, and the
// viewer's mesh batch (megabytes at modest sizes). Neither is in `schema.outputs`.
const PLUMBING = new Set(['Selva.Schema.Models.UISchema', 'Selva.Slva.DisplayBatch']);

export const isPlumbing = (tree: DataTree) => {
	const items = Object.values(tree.InnerTree ?? {}).flat();
	return items.length > 0 && items.every((i) => PLUMBING.has(i.type));
};

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

interface FileLink {
	name: string;
	bytes: number;
	url: string;
}

/** Each file item, held for download; the payload keys are PascalCase or camelCase depending on the serializer. */
async function fileLinks(items: TreeItem[], origin: string, stash: Stash): Promise<FileLink[]> {
	const links: FileLink[] = [];
	for (const i of items.filter((x) => x.type === FILE)) {
		const f = (parseItem(i.data) ?? {}) as Record<string, unknown>;
		const field = (pascal: string) => f[pascal] ?? f[pascal[0].toLowerCase() + pascal.slice(1)];
		const base = field('FileName');
		const ext = field('FileType');
		const name =
			(typeof base === 'string' && base ? base : 'unnamed') + (typeof ext === 'string' ? ext : '');
		const raw = field('Data');
		const text = typeof raw === 'string' ? raw : '';
		const data =
			field('IsBase64Encoded') === true ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
		const token = await stash.put({
			kind: 'file',
			name,
			contentType: 'application/octet-stream',
			data: new Uint8Array(data)
		});
		links.push({
			name,
			bytes: data.byteLength,
			url: `${origin}${MCP_FILES_PREFIX}${token}/${encodeURIComponent(name)}`
		});
	}
	return links;
}

// ============================================================================
// Charts and computed lists, as text
// ============================================================================

/** Parses an item, unwrapping the JSON strings Compute may wrap it in. */
function parseDeep(data: string): unknown {
	let value: unknown = data;
	for (let i = 0; i < 3 && typeof value === 'string'; i++) {
		try {
			value = JSON.parse(value);
		} catch {
			break;
		}
	}
	return value;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

interface ChartTrace {
	type: string;
	name?: string;
	labels?: unknown[];
	values?: unknown[];
	x?: unknown[];
	y?: unknown[];
}

interface ChartSummary {
	title?: string;
	traces: ChartTrace[];
}

/** A Plotly figure's title and data, or null when `value` is not one. */
function readFigure(value: unknown): ChartSummary | null {
	if (!isRecord(value) || !Array.isArray(value.data)) return null;
	const layout = isRecord(value.layout) ? value.layout : {};
	const title = isRecord(layout.title) ? layout.title.text : layout.title;
	const array = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_SCALARS) : undefined);
	const traces = value.data.filter(isRecord).map((t) => {
		const trace: ChartTrace = { type: typeof t.type === 'string' ? t.type : 'scatter' };
		if (typeof t.name === 'string' && t.name) trace.name = t.name;
		for (const key of ['labels', 'values', 'x', 'y'] as const) {
			const data = array(t[key]);
			if (data) trace[key] = data;
		}
		return trace;
	});
	return { ...(typeof title === 'string' && title && { title }), traces };
}

const numberText = (v: unknown) =>
	typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);

function chartText(chart: ChartSummary): string {
	const parts = chart.traces.map((t) => {
		const keys = t.labels ?? t.x;
		const values = t.values ?? t.y;
		const head = `${t.type}${t.name ? ` "${t.name}"` : ''}`;
		if (!keys || !values) return head;
		const pairs = keys.map((k, i) => `${String(k)} ${numberText(values[i])}`);
		const numbers = values.filter((v): v is number => typeof v === 'number');
		const sum =
			t.type === 'pie' && numbers.length === values.length
				? ` (sum ${numberText(numbers.reduce((a, b) => a + b, 0))})`
				: '';
		return `${head}: ${pairs.join('; ')}${sum}`;
	});
	return `chart${chart.title ? ` "${chart.title}"` : ''}, ${parts.join(' | ')}`;
}

interface ListPayload {
	targetInputId?: string | null;
	options?: Record<string, string>;
	rows?: { key: string; label?: string | null; section?: string | null }[] | null;
	members?: string[] | null;
	pickTable?: { by?: string[] | null; inputs: string[] } | null;
}

function readListPayload(value: unknown): ListPayload | null {
	return isRecord(value) && ('targetInputId' in value || 'options' in value)
		? (value as ListPayload)
		: null;
}

/** Option names for values, in the form's words. */
const namesOf = (options: Record<string, string>) => Object.keys(options);
const nameOf = (options: Record<string, string> | undefined, value: unknown) =>
	(options && Object.keys(options).find((n) => options[n] === value)) ?? value;

/** What one computed list output does, in the form's labels. */
function listOutputText(payload: ListPayload, labelOf: (id: string) => string): string {
	const quoted = (ids: string[]) => ids.map((id) => `"${labelOf(id)}"`).join(', ');
	if (payload.rows && payload.members) {
		const rows = payload.rows.map(
			(r) => `${r.label || r.key}${r.section ? ` (${r.section})` : ''}`
		);
		return `${rows.length} rows, each with ${quoted(payload.members)}: ${rows.join(', ')}`;
	}
	if (payload.pickTable) {
		const by = payload.pickTable.by?.length ? `, narrowed by ${quoted(payload.pickTable.by)}` : '';
		return `fills ${quoted(payload.pickTable.inputs)}${by}`;
	}
	const options = payload.options ?? {};
	const target = payload.targetInputId
		? `options for "${labelOf(payload.targetInputId)}"`
		: 'options';
	return `${target}: ${namesOf(options).join(', ') || 'none'}`;
}

/** Each computed list's options and the pick the solve used, as the form would show them. */
function listsText(
	schema: UISchema,
	values: Record<string, unknown>,
	labelOf: (id: string) => string
): { lines: string[]; structured: Record<string, unknown> } {
	const model = buildFormModel(schema, values);
	const lines: string[] = [];
	const structured: Record<string, unknown> = {};
	for (const [id, options] of Object.entries(model.options)) {
		const pick = nameOf(options, model.shown[id] ?? values[id]);
		const label = labelOf(id);
		structured[label] = { options: namesOf(options), ...(pick !== undefined && { pick }) };
		lines.push(
			`- "${label}": one of ${namesOf(options)
				.map((n) => `"${n}"`)
				.join(
					', '
				)}${pick !== undefined && pick !== '' ? `; the solve used "${String(pick)}"` : ''}`
		);
	}
	for (const repeat of model.repeats) {
		for (const member of repeat.members) {
			const label = labelOf(member);
			const shown = model.shown[member] as unknown[] | undefined;
			const rows = repeat.rows.map((row, i) => {
				const options = model.rowOptions[member]?.[i] ?? {};
				return {
					row: row.key,
					label: row.label ?? row.key,
					options: namesOf(options),
					pick: nameOf(options, shown?.[i])
				};
			});
			structured[label] = { rows };
			lines.push(
				`- "${label}", per row as a JSON object of row key to option name:`,
				...rows.map(
					(r) =>
						`  - ${r.row} (${r.label}): ${r.options.map((n) => `"${n}"`).join(', ')}; ` +
						`the solve used "${String(r.pick)}"`
				)
			);
		}
	}
	return { lines, structured };
}

function sizeText(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function summarizeSolve(
	res: SolveResponse,
	schema: UISchema,
	options: {
		origin: string;
		link: string;
		stash: Stash;
		/** The values solved with, by input id. Inputs left out read as their defaults. */
		values?: Record<string, unknown>;
	}
): Promise<ToolOutput> {
	const lines: string[] = [];
	const structured: Record<string, unknown> = {};
	const declared = new Map(schema.outputs.map((o) => [o.nickname, o.type]));
	const outputId = new Map(schema.outputs.map((o) => [o.nickname, o.id]));
	const described = describeInputs(schema);
	const labelOf = (id: string) => described.find((d) => d.input.id === id)?.label ?? id;
	// Input values and list payloads by id, as the form model reads them.
	const formValues: Record<string, unknown> = Object.fromEntries(
		schema.inputs.filter((i) => i.default !== undefined).map((i) => [i.id, i.default])
	);
	Object.assign(formValues, options.values);
	let anyLists = false;
	let anyFiles = false;

	for (const tree of res.values ?? []) {
		if (isPlumbing(tree)) continue;
		const items = Object.values(tree.InnerTree ?? {}).flat();
		const kind = declared.get(tree.ParamName);

		const lists =
			kind === 'dynamicValueList' || items.some((i) => /DynamicValueList/.test(i.type))
				? items.map((i) => readListPayload(parseDeep(i.data)))
				: [];
		if (lists.length && lists.every(Boolean)) {
			const payload = lists[0]!;
			const id = outputId.get(tree.ParamName);
			if (id) formValues[id] = payload;
			anyLists = true;
			structured[tree.ParamName] = payload.pickTable
				? {
						fills: payload.pickTable.inputs.map(labelOf),
						by: (payload.pickTable.by ?? []).map(labelOf)
					}
				: payload.rows
					? { rows: payload.rows, members: (payload.members ?? []).map(labelOf) }
					: { options: namesOf(payload.options ?? {}) };
			lines.push(`${tree.ParamName}: ${listOutputText(payload, labelOf)}`);
			continue;
		}

		const charts =
			kind === 'chart' || items.some((i) => /Plotly/i.test(i.type))
				? items.map((i) => readFigure(parseDeep(i.data)))
				: [];
		if (charts.length && charts.every(Boolean)) {
			const read = charts as ChartSummary[];
			structured[tree.ParamName] = read.length === 1 ? read[0] : read;
			lines.push(`${tree.ParamName}: ${read.map(chartText).join(' || ')}`);
			continue;
		}
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
		const read = items.every((i) => isValueListType(i.type))
			? readValueLists(schema, tree.ParamName, items)
			: items.every((i) => isChartType(i.type))
				? readCharts(items)
				: undefined;
		if (items.length && read) {
			structured[tree.ParamName] = read.structured;
			lines.push(`${tree.ParamName}: ${read.text}`);
			continue;
		}
		const counts = new Map<string, number>();
		for (const i of items) {
			const name = i.type.split('.').pop() ?? i.type;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		const vertices = await meshVertexCount(items);
		const files = await fileLinks(items, options.origin, options.stash);
		anyFiles ||= files.length > 0;
		const parts = [...counts].map(([type, n]) => `${n} ${type}`);
		if (vertices !== null) parts.push(`${vertices.toLocaleString('en-US')} vertices`);
		if (files.length) {
			parts.push(
				`files: ${files.map((f) => `${f.name} (${sizeText(f.bytes)}) ${f.url}`).join(', ')}`
			);
		}
		structured[tree.ParamName] = {
			geometry: Object.fromEntries(counts),
			...(vertices !== null && { vertices }),
			...(files.length && { files })
		};
		lines.push(`${tree.ParamName}: ${items.length ? parts.join(', ') : 'empty'}`);
	}

	if (!lines.length) lines.push('The solve returned no outputs.');
	let lists: Record<string, unknown> | undefined;
	if (anyLists) {
		const text = listsText(schema, formValues, labelOf);
		if (text.lines.length) {
			lines.push('', 'Lists computed in this solve, and what they offer now:', ...text.lines, '');
			lists = text.structured;
		}
	}
	if (anyFiles) lines.push('File links download the file and expire within the hour.');
	if (res.selva?.outcome) lines.push(`Outcome: ${JSON.stringify(res.selva.outcome)}`);
	for (const e of res.errors ?? []) lines.push(`Error: ${e}`);
	for (const w of res.warnings ?? []) lines.push(`Warning: ${w}`);
	if (res.errors?.length) {
		lines.push(
			'To find out whether the Compute server lacks a plugin or component this definition needs, call selva_check_definition.'
		);
	}
	lines.push(`View the geometry at ${options.link}`);

	return {
		text: lines.join('\n'),
		structured: {
			outputs: structured,
			...(lists && { lists }),
			errors: res.errors ?? [],
			warnings: res.warnings ?? [],
			link: options.link
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
