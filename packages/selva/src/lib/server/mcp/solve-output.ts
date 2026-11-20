import type { ToolOutput } from '@selvajs/mcp';
import type { UISchema } from '@selvajs/schemas';
import type { RhinoModule } from 'rhino3dm';
import { MCP_FILES_PREFIX } from './path.js';
import type { Stash } from './stash.js';
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

function sizeText(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function summarizeSolve(
	res: SolveResponse,
	schema: UISchema,
	options: { origin: string; link: string; stash: Stash }
): Promise<ToolOutput> {
	const lines: string[] = [];
	const structured: Record<string, unknown> = {};
	const declared = new Map(schema.outputs.map((o) => [o.nickname, o.type]));
	let anyFiles = false;

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
