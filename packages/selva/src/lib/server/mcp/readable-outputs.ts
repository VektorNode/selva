import type { UISchema } from '@selvajs/schemas';
import { describeInputs } from './form.js';

// ============================================================================
// Selva's own output types, as text for the model
// ============================================================================
//
// Compute sends these as JSON in a goo's item, which the summary would otherwise report as a
// type count. They are Selva's or a chart plugin's wire shapes, so the server can read them.

/** Past this many entries a list or table shows its head. */
const MAX_ENTRIES = 50;

export const isValueListType = (type: string) => type.endsWith('.DynamicValueListGoo');
export const isChartType = (type: string) => /(^|\.)PlotlyFigure$/.test(type);

/** Compute may quote a goo's JSON once more. */
function decode(data: string): unknown {
	let value: unknown = data;
	for (let i = 0; i < 2 && typeof value === 'string'; i++) {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	return value;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Each input's options as this solve computed them, name to value, keyed by input id. Only plain
 * lists: an Options Table narrows by the picks on screen, which a static form can't follow.
 */
export function solvedOptions(
	schema: UISchema,
	trees: { ParamName: string; InnerTree: Record<string, { type: string; data: string }[]> }[]
): Map<string, Record<string, string>> {
	const found = new Map<string, Record<string, string>>();
	for (const tree of trees) {
		const schemaTarget = schema.outputs.find((o) => o.nickname === tree.ParamName)?.targetInputId;
		for (const item of Object.values(tree.InnerTree ?? {}).flat()) {
			if (!isValueListType(item.type)) continue;
			const payload = decode(item.data);
			if (!isRecord(payload) || !isRecord(payload.options)) continue;
			const target =
				typeof payload.targetInputId === 'string' ? payload.targetInputId : schemaTarget;
			const options = Object.entries(payload.options).filter(
				(e): e is [string, string] => typeof e[1] === 'string'
			);
			if (target && options.length) found.set(target, Object.fromEntries(options));
		}
	}
	return found;
}

function head<T>(list: T[]): { shown: T[]; more: number } {
	return { shown: list.slice(0, MAX_ENTRIES), more: Math.max(0, list.length - MAX_ENTRIES) };
}

const quoted = (names: string[]) => names.map((n) => JSON.stringify(n)).join(', ');
const andMore = (more: number) => (more ? `, and ${more} more` : '');

export interface ReadOutput {
	text: string;
	structured: Record<string, unknown>;
}

/**
 * The options a Dynamic Value List output computed, by the label of the input they fill, and an
 * Options Table's valid combinations. These change with other inputs, so the form's own list is
 * only the author's defaults.
 */
export function readValueLists(
	schema: UISchema,
	paramName: string,
	items: { data: string }[]
): ReadOutput | undefined {
	const labels = new Map(describeInputs(schema).map((d) => [d.input.id, d.label]));
	const schemaTarget = schema.outputs.find((o) => o.nickname === paramName)?.targetInputId;
	const labelOf = (id: string) => labels.get(id) ?? id;

	const parts: string[] = [];
	const options: Record<string, string[]> = {};
	const combinations: { inputs: string[]; rows: string[][]; count: number }[] = [];

	for (const item of items) {
		const payload = decode(item.data);
		if (!isRecord(payload)) continue;

		const target = typeof payload.targetInputId === 'string' ? payload.targetInputId : schemaTarget;
		const names = isRecord(payload.options) ? Object.keys(payload.options) : [];
		if (target && names.length) {
			const label = labelOf(target);
			const { shown, more } = head(names);
			options[label] = shown;
			parts.push(`options for "${label}": ${quoted(shown)}${andMore(more)}`);
		}

		const table = payload.pickTable;
		if (isRecord(table) && Array.isArray(table.inputs) && Array.isArray(table.rows)) {
			const by = Array.isArray(table.by) ? table.by : [];
			const columns = [...by, ...table.inputs].map((id) => labelOf(String(id)));
			const rows = table.rows.filter(Array.isArray).map((r) => r.map(String));
			const { shown, more } = head(rows);
			combinations.push({ inputs: columns, rows: shown, count: rows.length });
			parts.push(
				`valid combinations of ${quoted(columns)}: ` +
					shown.map((r) => `[${quoted(r)}]`).join(', ') +
					andMore(more)
			);
		}
	}

	if (!parts.length) return undefined;
	return {
		text: parts.join('; '),
		structured: {
			...(Object.keys(options).length && { options }),
			...(combinations.length && { combinations })
		}
	};
}

interface Series {
	name?: string;
	type: string;
	points: [string, unknown][];
	count: number;
}

/** A trace's data as label/value pairs: pie labels, else x against y (or y against x for horizontal bars). */
function pointsOf(trace: Record<string, unknown>): [unknown[], unknown[]] | undefined {
	const list = (key: string) => (Array.isArray(trace[key]) ? (trace[key] as unknown[]) : undefined);
	if (list('labels') && list('values')) return [list('labels')!, list('values')!];
	const x = list('x');
	const y = list('y');
	if (x && y) return trace.orientation === 'h' ? [y, x] : [x, y];
	if (y) return [y.map((_, i) => i), y];
	if (x) return [x.map((_, i) => i), x];
	return undefined;
}

/** A Plotly figure's title and each trace's data. */
export function readCharts(items: { data: string }[]): ReadOutput | undefined {
	const parts: string[] = [];
	const charts: { title?: string; series: Series[] }[] = [];

	for (const item of items) {
		const figure = decode(item.data);
		if (!isRecord(figure) || !Array.isArray(figure.data)) continue;
		const layout = isRecord(figure.layout) ? figure.layout : {};
		const rawTitle = layout.title;
		const title =
			typeof rawTitle === 'string'
				? rawTitle
				: isRecord(rawTitle) && typeof rawTitle.text === 'string'
					? rawTitle.text
					: undefined;

		const series: Series[] = [];
		const traces: string[] = [];
		for (const trace of figure.data.filter(isRecord)) {
			const pairs = pointsOf(trace);
			if (!pairs) continue;
			const [labels, values] = pairs;
			const all = labels.map((l, i): [string, unknown] => [String(l), values[i]]);
			const { shown, more } = head(all);
			const name = typeof trace.name === 'string' && trace.name ? trace.name : undefined;
			const type = typeof trace.type === 'string' ? trace.type : 'scatter';
			series.push({ name, type, points: shown, count: all.length });
			traces.push(
				`${name ? `"${name}" ` : ''}(${type}): ` +
					shown.map(([l, v]) => `${l} = ${JSON.stringify(v)}`).join(', ') +
					andMore(more)
			);
		}
		charts.push({ ...(title && { title }), series });
		const body = traces.length ? traces.join('; ') : 'no data';
		parts.push(title ? `chart "${title}": ${body}` : body);
	}

	if (!charts.length) return undefined;
	return {
		text: parts.join(' | '),
		structured: { charts }
	};
}
