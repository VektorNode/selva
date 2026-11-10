import type { UISchema, OutputDynamicValueListLayoutItem } from '@selvajs/schemas';
import { getLayoutItems } from '@selvajs/schemas';

/**
 * The runtime payload a dynamic value list output produces, keyed by the output's id in `values`.
 * Routed back into the dynamic value list input identified by `targetInputId`.
 */
export interface DynamicValueListPayload {
	targetInputId?: string | null;
	options?: Record<string, string>;
	/** Options By: the input whose value picks a branch of `table`. */
	by?: string | null;
	/** Options By: option sets keyed by the `by` input's value, `*` as the fallback. */
	table?: Record<string, Record<string, string>> | null;
	/** Repeat: one entry per row, in order. */
	rows?: RepeatRow[] | null;
	/** Repeat: the inputs shown once per row. Each value is a JSON object of row key to pick. */
	members?: string[] | null;
	/**
	 * The output is wired into its target, so Grasshopper resolves the target's pick in the same
	 * solve. The form shows the resolved pick and never sends a correction.
	 */
	resolvedInSolve?: boolean | null;
}

export interface RepeatRow {
	key: string;
	label?: string | null;
	section?: string | null;
}

function isDynamicValueListPayload(value: unknown): value is DynamicValueListPayload {
	return (
		typeof value === 'object' && value !== null && ('targetInputId' in value || 'options' in value)
	);
}

/**
 * Normalize a raw output value into a payload object.
 *
 * The local/WebSocket path delivers a real object; the Rhino.Compute path delivers the
 * component's JSON output as a string (possibly double-encoded by the compute layer), so try
 * to parse strings before giving up.
 */
function coercePayload(value: unknown): DynamicValueListPayload | null {
	if (isDynamicValueListPayload(value)) return value;

	let candidate = value;
	// Unwrap up to two layers of JSON string encoding (compute may quote the string output).
	for (let i = 0; i < 2 && typeof candidate === 'string'; i++) {
		try {
			candidate = JSON.parse(candidate);
		} catch {
			return null;
		}
		if (isDynamicValueListPayload(candidate)) return candidate;
	}

	return null;
}

// Memoizes string-payload coercion. In compute mode the payload arrives as a JSON
// string — several MB for a large options list — and the options map is derived from
// `values` (TabLayout), so it recomputes on EVERY value change. Unmemoized, each
// keystroke re-parses megabytes and allocates a fresh options object whose new
// identity re-renders the whole dropdown subtree; a 6.4 MB payload drove a tab OOM.
// Map keys use SameValueZero, so an identical string from a later solve also hits.
const coerceCache = new Map<string, DynamicValueListPayload | null>();
const COERCE_CACHE_MAX = 8;

function coercePayloadMemo(value: unknown): DynamicValueListPayload | null {
	// Only string payloads are expensive (JSON.parse); objects pass straight through.
	if (typeof value !== 'string' || value.length < 1024) return coercePayload(value);
	const hit = coerceCache.get(value);
	if (hit !== undefined || coerceCache.has(value)) {
		// Refresh LRU position.
		coerceCache.delete(value);
		coerceCache.set(value, hit ?? null);
		return hit ?? null;
	}
	const parseStart = performance.now();
	const parsed = coercePayload(value);
	// An expensive parse should happen ONCE per distinct solve result. If this line
	// storms the console, memoization is being defeated (payload strings differing
	// per recompute) — the churn pattern that could OOM a tab.
	if (value.length > 256 * 1024) {
		const optionCount = parsed?.options ? Object.keys(parsed.options).length : 0;
		console.info(
			`[DVL] parsed ${(value.length / (1024 * 1024)).toFixed(1)} MB options payload ` +
				`(${optionCount} options) in ${(performance.now() - parseStart).toFixed(0)}ms — cache miss`
		);
	}
	if (coerceCache.size >= COERCE_CACHE_MAX) {
		const oldest = coerceCache.keys().next().value;
		if (oldest !== undefined) coerceCache.delete(oldest);
	}
	coerceCache.set(value, parsed);
	return parsed;
}

/** One DynVL routing source: the id keying `values`, plus the schema-side target fallback. */
interface DynamicValueListSource {
	id: string;
	targetInputId?: string | null;
}

/**
 * Every dynamicValueList output reference in the schema.
 *
 * Canonical location is `schema.outputs[]` — the plugin's SchemaSynchronizer mirrors every
 * dynamicValueList layout item there (`CanonicalizeDynamicValueListOutputs`). The layout scan is
 * back-compat defense for schemas persisted by an older plugin that lacked that invariant; on
 * current schemas it finds nothing new. Deduped by id, `outputs[]` winning so the canonical
 * record's targetInputId takes precedence.
 */
function collectDynamicValueListSources(schema: UISchema): DynamicValueListSource[] {
	const byId = new Map<string, DynamicValueListSource>();

	for (const item of getLayoutItems(schema)) {
		if (item.type !== 'output' || item.widgetType !== 'dynamicValueList') continue;
		const dvl = item as OutputDynamicValueListLayoutItem;
		if (typeof dvl.paramId !== 'string') continue;
		byId.set(dvl.paramId, { id: dvl.paramId, targetInputId: dvl.config?.targetInputId });
	}

	for (const output of schema.outputs ?? []) {
		if (output.type !== 'dynamicValueList') continue;
		byId.set(output.id, { id: output.id, targetInputId: output.targetInputId });
	}

	return [...byId.values()];
}

/**
 * Build a map of `inputId -> computed options` from the solved output values.
 *
 * Reads each dynamicValueList source's `{ targetInputId, options }` payload from `values` and routes
 * the options to the targeted input. The payload's own `targetInputId` wins; the schema-side
 * `targetInputId` is the fallback when the payload omits it.
 */
export function buildDynamicValueListOptions(
	schema: UISchema,
	values: Record<string, unknown>
): Record<string, Record<string, string>> {
	return buildFormModel(schema, values).options;
}

// ============================================================================
// Option tables, repeats, and picks resolved in the solve
// ============================================================================

export interface RepeatSpec {
	/** The Repeat output's id. */
	id: string;
	rows: RepeatRow[];
	members: string[];
}

export interface FormModel {
	/** Options for each input shown once, keyed by input id. */
	options: Record<string, Record<string, string>>;
	/** Options for each row of a repeated input, keyed by input id. */
	rowOptions: Record<string, Record<string, string>[]>;
	repeats: RepeatSpec[];
	/** The repeat each member input belongs to. */
	repeatOf: Record<string, string>;
	/**
	 * What each input Grasshopper resolves in the solve shows, which is also what the solve uses:
	 * the pick if still offered, else the first option; one per row for a repeated input.
	 */
	shown: Record<string, unknown>;
}

const FALLBACK_KEY = '*';

function pickBranch(
	table: Record<string, Record<string, string>>,
	driverValue: unknown
): Record<string, string> {
	const key = driverValue === undefined || driverValue === null ? '' : String(driverValue);
	return table[key] ?? table[FALLBACK_KEY] ?? {};
}

function findOptionIndex(entries: [string, string][], pick: unknown): number {
	if (typeof pick !== 'string') return -1;
	const wanted = pick.toLowerCase();
	return entries.findIndex(
		([name, value]) => value.toLowerCase() === wanted || name.toLowerCase() === wanted
	);
}

/**
 * The option value a pick resolves to, as Grasshopper resolves it in the solve: the pick if still
 * offered (by value or name, ignoring case), else the first option. With no options known the
 * pick passes through. `packages/schemas/fixtures/dynamic-value-list-resolution.json` pins both.
 */
export function resolvePick(options: Record<string, string> | undefined, pick: unknown): string {
	const entries = Object.entries(options ?? {});
	if (entries.length === 0) return typeof pick === 'string' ? pick : '';
	return entries[Math.max(0, findOptionIndex(entries, pick))][1];
}

/**
 * Checklist: the picks still offered, in pick order; none left gives the first option. Duplicates
 * collapse by option, not by value, so two options sharing a value both stay.
 */
export function resolvePicks(
	options: Record<string, string> | undefined,
	picks: unknown[]
): string[] {
	const entries = Object.entries(options ?? {});
	if (entries.length === 0) return picks.filter((p): p is string => typeof p === 'string');
	const kept = new Set<number>();
	for (const pick of picks) {
		const index = findOptionIndex(entries, pick);
		if (index >= 0) kept.add(index);
	}
	return kept.size > 0 ? [...kept].map((i) => entries[i][1]) : [entries[0][1]];
}

/**
 * A checklist edit made on the resolved picks, merged back into the stored ones: picks not offered
 * now were never shown, so the edit can't have removed them, and they come back when offered again.
 */
export function keepHiddenPicks(
	options: Record<string, string> | undefined,
	stored: unknown,
	edited: string[]
): string[] {
	const entries = Object.entries(options ?? {});
	if (entries.length === 0 || !Array.isArray(stored)) return edited;
	const hidden = stored.filter(
		(pick): pick is string =>
			typeof pick === 'string' && findOptionIndex(entries, pick) < 0 && !edited.includes(pick)
	);
	return [...edited, ...hidden];
}

/**
 * A repeated input's picks. Its value is one JSON object of row key to pick, so a pick stays with
 * its row when rows come and go, and the value is a plain string on the wire. Anything else reads
 * as no picks.
 */
export function readRowPicks(value: unknown): Record<string, string> {
	if (typeof value !== 'string' || !value.trimStart().startsWith('{')) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch {
		return {};
	}
}

/** The repeated input's value with one row's pick set. Picks for rows not shown now are kept. */
export function withRowPick(value: unknown, rowKey: string, pick: string): string {
	return JSON.stringify({ ...readRowPicks(value), [rowKey]: pick });
}

interface Lookup {
	options: FormModel['options'];
	rowOptions: FormModel['rowOptions'];
}

interface SourcedPayload {
	source: DynamicValueListSource;
	payload: DynamicValueListPayload;
}

function lookUpOptions(
	payloads: SourcedPayload[],
	repeatById: Map<string, RepeatSpec>,
	repeatOf: Record<string, string>,
	read: (id: string) => unknown
): Lookup {
	const options: Lookup['options'] = {};
	const rowOptions: Lookup['rowOptions'] = {};

	for (const { source, payload } of payloads) {
		const target = payload.targetInputId ?? source.targetInputId;
		if (!target) continue;
		const repeat = repeatById.get(repeatOf[target]);

		if (payload.table && typeof payload.table === 'object' && payload.by) {
			// As Options By does in the solve: one branch per item `by` holds (a row of a repeat, a
			// ticked checklist item), row i taking item i and the last item covering the rest; an
			// input shown once takes item 0.
			const driver = read(payload.by);
			const items = Array.isArray(driver) ? driver : [driver];
			const table = payload.table;
			const branches = (items.length > 0 ? items : [undefined]).map((item) =>
				pickBranch(table, item)
			);
			if (repeat) {
				rowOptions[target] = repeat.rows.map((_, i) => branches[Math.min(i, branches.length - 1)]);
			} else {
				options[target] = branches[0];
			}
		} else if (payload.options && typeof payload.options === 'object') {
			if (repeat) rowOptions[target] = repeat.rows.map(() => payload.options!);
			else options[target] = payload.options;
		}
	}

	return { options, rowOptions };
}

/**
 * What the form shows, from the payloads the last solve returned and the values on screen now.
 * A table is looked up against the value its `by` input shows, so changing that input switches
 * the list without a solve.
 *
 * Pass the previous model to keep the identity of every array that didn't change: this runs on
 * each value change, and a fresh array re-renders its whole checklist or repeat.
 */
export function buildFormModel(
	schema: UISchema,
	values: Record<string, unknown>,
	previous?: FormModel
): FormModel {
	const payloads: SourcedPayload[] = [];
	for (const source of collectDynamicValueListSources(schema)) {
		const payload = coercePayloadMemo(values[source.id]);
		if (payload) payloads.push({ source, payload });
	}

	const repeats: RepeatSpec[] = [];
	const repeatOf: Record<string, string> = {};
	for (const { source, payload } of payloads) {
		if (!Array.isArray(payload.rows) || !Array.isArray(payload.members)) continue;
		const rows = payload.rows.filter((r): r is RepeatRow => typeof r?.key === 'string');
		repeats.push({ id: source.id, rows, members: payload.members });
		for (const member of payload.members) repeatOf[member] = source.id;
	}
	const repeatById = new Map(repeats.map((r) => [r.id, r]));

	const resolvedSingles = new Set<string>();
	for (const { source, payload } of payloads) {
		const target = payload.targetInputId ?? source.targetInputId;
		if (target && payload.resolvedInSolve && !repeatOf[target]) resolvedSingles.add(target);
	}

	// A table reads the value its driver shows, and the driver may itself be resolved, so look up
	// until nothing changes. Grasshopper refuses a cycle of wires: one pass per table is enough.
	// With no table driven by a resolved input, the first pass is final.
	const chained = payloads.some(
		({ payload }) =>
			payload.table && payload.by && (resolvedSingles.has(payload.by) || repeatOf[payload.by])
	);
	let shown: Record<string, unknown> = {};
	let lookup: Lookup = { options: {}, rowOptions: {} };
	for (let pass = 0; pass <= payloads.length; pass++) {
		const read = (id: string) => (id in shown ? shown[id] : values[id]);
		lookup = lookUpOptions(payloads, repeatById, repeatOf, read);
		const next: Record<string, unknown> = {};
		for (const id of resolvedSingles) {
			const value = values[id];
			next[id] = Array.isArray(value)
				? resolvePicks(lookup.options[id], value)
				: resolvePick(lookup.options[id], value);
		}
		for (const repeat of repeats) {
			for (const member of repeat.members) {
				const picks = readRowPicks(values[member]);
				next[member] = repeat.rows.map((row, i) =>
					resolvePick(lookup.rowOptions[member]?.[i], picks[row.key])
				);
			}
		}
		const settled = !chained || sameEntries(next, shown);
		shown = next;
		if (settled) break;
	}

	if (previous) {
		reuseUnchanged(shown, previous.shown);
		reuseUnchanged(lookup.rowOptions, previous.rowOptions);
	}
	return { ...lookup, repeats, repeatOf, shown };
}

function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	return a.every((item, i) => item === b[i]);
}

function sameEntries(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length && keys.every((k) => k in b && sameValue(a[k], b[k]))
	);
}

function reuseUnchanged(next: Record<string, unknown>, previous: Record<string, unknown>) {
	for (const key of Object.keys(next)) {
		if (key in previous && sameValue(next[key], previous[key])) next[key] = previous[key];
	}
}
