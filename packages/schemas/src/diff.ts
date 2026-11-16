// What changed between two versions of a definition, as its users feel it.
//
// Inputs and outputs are matched by parameter id (the Grasshopper InstanceGuid), not by name:
// a renamed slider is the same input, and a deleted-then-recreated one is a different input even
// with the same name, because saved values, presets, share links and API callers key on the id.
//
// Impact is judged from the caller's side:
//   breaking: something that worked before can now fail or mean something else (an input or
//             output gone, a type or structure changed, an option or range that a saved value
//             may still use removed)
//   notable:  behaviour changes but old values still apply (new inputs, new defaults, wider range)
//   cosmetic: wording, order and layout only

import type {
	GroupConfig,
	InputLayoutItem,
	LayoutItem,
	SchemaInput,
	SchemaOutput,
	UISchema
} from './generated/index.js';
import { getGroups } from './traversal.js';

export type SchemaChangeImpact = 'breaking' | 'notable' | 'cosmetic';

export interface SchemaChange {
	kind: 'input' | 'output' | 'settings';
	change: 'added' | 'removed' | 'changed';
	/** Parameter id for inputs and outputs; the setting's name for settings. */
	id: string;
	/** What the form shows: the layout item's display name, else the Grasshopper nickname. */
	label: string;
	impact: SchemaChangeImpact;
	/** One line per difference, e.g. `default 10 → 12`. Empty for added and removed. */
	details: string[];
}

export interface SchemaDiff {
	/** Breaking first, then notable, then cosmetic; inputs before outputs before settings. */
	changes: SchemaChange[];
	counts: Record<SchemaChangeImpact, number>;
	/** No difference a user can see. The Grasshopper logic behind the form may still differ. */
	identical: boolean;
}

const IMPACT_RANK: Record<SchemaChangeImpact, number> = { breaking: 0, notable: 1, cosmetic: 2 };
const KIND_RANK: Record<SchemaChange['kind'], number> = { input: 0, output: 1, settings: 2 };

export function diffSchemas(before: UISchema, after: UISchema): SchemaDiff {
	const changes = [
		...diffInputs(before, after),
		...diffOutputs(before, after),
		...diffSettings(before, after)
	].sort(
		(a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || KIND_RANK[a.kind] - KIND_RANK[b.kind]
	);
	const counts = { breaking: 0, notable: 0, cosmetic: 0 };
	for (const c of changes) counts[c.impact] += 1;
	return { changes, counts, identical: changes.length === 0 };
}

// ============================================================================
// Inputs
// ============================================================================

interface Placed {
	item: LayoutItem;
	group: string;
}

/** The first layout item per parameter, with the label of the group it sits in. */
function placements(schema: UISchema, type: 'input' | 'output'): Map<string, Placed> {
	const out = new Map<string, Placed>();
	for (const group of getGroups(schema) as GroupConfig[]) {
		for (const item of group.items ?? []) {
			if (item.type !== type || !('paramId' in item) || out.has(item.paramId)) continue;
			out.set(item.paramId, { item, group: group.label });
		}
	}
	return out;
}

function labelOf(nickname: string, placed: Placed | undefined): string {
	const display =
		placed?.item && 'displayName' in placed.item ? placed.item.displayName : undefined;
	return (typeof display === 'string' && display.trim()) || nickname || 'Unnamed';
}

function diffInputs(before: UISchema, after: UISchema): SchemaChange[] {
	const oldInputs = byId(before.inputs);
	const newInputs = byId(after.inputs);
	const oldPlaced = placements(before, 'input');
	const newPlaced = placements(after, 'input');
	const changes: SchemaChange[] = [];

	for (const [id, input] of oldInputs) {
		if (newInputs.has(id)) continue;
		changes.push(
			whole('input', 'removed', id, labelOf(input.nickname, oldPlaced.get(id)), 'breaking')
		);
	}
	for (const [id, input] of newInputs) {
		const label = labelOf(input.nickname, newPlaced.get(id));
		const old = oldInputs.get(id);
		if (!old) {
			changes.push(whole('input', 'added', id, label, 'notable'));
			continue;
		}
		const found = compareInput(old, input, oldPlaced.get(id), newPlaced.get(id));
		if (found.length > 0) changes.push(changed('input', id, label, found));
	}
	return changes;
}

type Finding = [SchemaChangeImpact, string];

function compareInput(
	a: SchemaInput,
	b: SchemaInput,
	pa: Placed | undefined,
	pb: Placed | undefined
): Finding[] {
	const found: Finding[] = [];
	if (a.paramType !== b.paramType) found.push(['breaking', `type ${a.paramType} → ${b.paramType}`]);
	const sa = a.inputStructure ?? 'item';
	const sb = b.inputStructure ?? 'item';
	if (sa !== sb) found.push(['breaking', `takes ${sa} → ${sb}`]);
	if (!same(a.default, b.default)) {
		found.push(['notable', `default ${show(a.default)} → ${show(b.default)}`]);
	}

	const ia = pa?.item as InputLayoutItem | undefined;
	const ib = pb?.item as InputLayoutItem | undefined;
	if (ia && ib) {
		const kindA = ia.source?.kind ?? 'user';
		const kindB = ib.source?.kind ?? 'user';
		if (kindA !== kindB) found.push(['breaking', `filled by ${kindA} → ${kindB}`]);
		if (ia.widgetType !== ib.widgetType) {
			found.push(['notable', `shown as ${ia.widgetType} → ${ib.widgetType}`]);
		}
		found.push(...compareInputConfig(ia, ib));
		found.push(...compareShared(ia, ib, pa!.group, pb!.group));
	} else if (!ia !== !ib) {
		found.push(['notable', ib ? 'now on the form' : 'no longer on the form']);
	}
	if (a.nickname !== b.nickname && !(ia?.displayName || ib?.displayName)) {
		found.push(['cosmetic', `renamed ${a.nickname} → ${b.nickname}`]);
	}
	return found;
}

function compareInputConfig(a: InputLayoutItem, b: InputLayoutItem): Finding[] {
	const ca = (a.config ?? {}) as Record<string, unknown>;
	const cb = (b.config ?? {}) as Record<string, unknown>;
	const found: Finding[] = [];

	if (a.widgetType === 'number' && b.widgetType === 'number') {
		const [minA, maxA] = [num(ca.minimum), num(ca.maximum)];
		const [minB, maxB] = [num(cb.minimum), num(cb.maximum)];
		if (minA !== minB || maxA !== maxB) {
			// A saved value inside the old range may sit outside a narrower one.
			const narrower =
				(minB !== undefined && (minA === undefined || minB > minA)) ||
				(maxB !== undefined && (maxA === undefined || maxB < maxA));
			found.push([
				narrower ? 'breaking' : 'notable',
				`range ${range(minA, maxA)} → ${range(minB, maxB)}${narrower ? ' (narrower)' : ''}`
			]);
		}
		if (num(ca.stepSize) !== num(cb.stepSize)) {
			found.push(['notable', `step ${show(ca.stepSize)} → ${show(cb.stepSize)}`]);
		}
	}

	const optsA = options(a);
	const optsB = options(b);
	if (optsA && optsB) {
		const removed = [...optsA.keys()].filter((k) => !optsB.has(k));
		const added = [...optsB.keys()].filter((k) => !optsA.has(k));
		const revalued = [...optsB.keys()].filter((k) => optsA.has(k) && optsA.get(k) !== optsB.get(k));
		// A saved pick of a removed option no longer matches anything.
		if (removed.length) found.push(['breaking', `options removed: ${list(removed)}`]);
		if (added.length) found.push(['notable', `options added: ${list(added)}`]);
		if (revalued.length) found.push(['notable', `option values changed: ${list(revalued)}`]);
	}

	for (const key of ['displayAs', 'required', 'maxLength', 'pattern', 'acceptedFormats'] as const) {
		if (!same(ca[key], cb[key]))
			found.push(['notable', `${key} ${show(ca[key])} → ${show(cb[key])}`]);
	}
	return found;
}

/** Dropdown options, or a dynamic list's seed options: name → value. */
function options(item: InputLayoutItem): Map<string, string> | null {
	const config = (item.config ?? {}) as Record<string, unknown>;
	const raw =
		item.widgetType === 'dropdown'
			? config.options
			: item.widgetType === 'dynamicValueList'
				? config.defaultOptions
				: undefined;
	if (!raw || typeof raw !== 'object') return null;
	return new Map(Object.entries(raw as Record<string, string>).map(([k, v]) => [k, String(v)]));
}

// ============================================================================
// Outputs
// ============================================================================

function diffOutputs(before: UISchema, after: UISchema): SchemaChange[] {
	const oldOutputs = byId(before.outputs);
	const newOutputs = byId(after.outputs);
	const oldPlaced = placements(before, 'output');
	const newPlaced = placements(after, 'output');
	const changes: SchemaChange[] = [];

	for (const [id, output] of oldOutputs) {
		if (newOutputs.has(id)) continue;
		changes.push(
			whole('output', 'removed', id, labelOf(output.nickname, oldPlaced.get(id)), 'breaking')
		);
	}
	for (const [id, output] of newOutputs) {
		const label = labelOf(output.nickname, newPlaced.get(id));
		const old = oldOutputs.get(id);
		if (!old) {
			changes.push(whole('output', 'added', id, label, 'notable'));
			continue;
		}
		const found = compareOutput(old, output, oldPlaced.get(id), newPlaced.get(id));
		if (found.length > 0) changes.push(changed('output', id, label, found));
	}
	return changes;
}

function compareOutput(
	a: SchemaOutput,
	b: SchemaOutput,
	pa: Placed | undefined,
	pb: Placed | undefined
): Finding[] {
	const found: Finding[] = [];
	if (a.type !== b.type) found.push(['breaking', `type ${a.type} → ${b.type}`]);
	if (pa && pb) {
		const wa = (pa.item as { widgetType?: string }).widgetType;
		const wb = (pb.item as { widgetType?: string }).widgetType;
		if (wa !== wb) found.push(['notable', `shown as ${wa} → ${wb}`]);
		found.push(...compareShared(pa.item, pb.item, pa.group, pb.group));
	} else if (!pa !== !pb) {
		found.push(['notable', pb ? 'now on the page' : 'no longer on the page']);
	}
	if (a.nickname !== b.nickname) found.push(['cosmetic', `renamed ${a.nickname} → ${b.nickname}`]);
	return found;
}

/** What inputs and outputs share: visibility, label, help text, group. */
function compareShared(a: LayoutItem, b: LayoutItem, groupA: string, groupB: string): Finding[] {
	const ia = a as Record<string, unknown>;
	const ib = b as Record<string, unknown>;
	const found: Finding[] = [];
	if ((ia.visible ?? true) !== (ib.visible ?? true)) {
		found.push(['notable', ib.visible === false ? 'now hidden' : 'now shown']);
	}
	if (!same(ia.visibilityCondition, ib.visibilityCondition)) {
		found.push(['notable', 'show/hide rule changed']);
	}
	if ((ia.displayName ?? '') !== (ib.displayName ?? '')) {
		found.push(['cosmetic', `label ${show(ia.displayName)} → ${show(ib.displayName)}`]);
	}
	if ((ia.description ?? '') !== (ib.description ?? ''))
		found.push(['cosmetic', 'help text changed']);
	if (groupA !== groupB) found.push(['cosmetic', `moved ${groupA} → ${groupB}`]);
	return found;
}

// ============================================================================
// Settings
// ============================================================================

function diffSettings(before: UISchema, after: UISchema): SchemaChange[] {
	const changes: SchemaChange[] = [];
	const setting = (
		id: string,
		label: string,
		impact: SchemaChangeImpact,
		a: unknown,
		b: unknown
	) => {
		if (!same(a, b))
			changes.push(changed('settings', id, label, [[impact, `${show(a)} → ${show(b)}`]]));
	};
	setting(
		'instanceSolve',
		'Solve on every change',
		'notable',
		before.instanceSolve ?? true,
		after.instanceSolve ?? true
	);
	setting(
		'previewSolves',
		'Preview solves',
		'notable',
		before.previewSolves ?? false,
		after.previewSolves ?? false
	);
	setting(
		'viewer',
		'3D viewer',
		'notable',
		before.viewerOptions?.enableRemote ?? false,
		after.viewerOptions?.enableRemote ?? false
	);
	setting('name', 'Name', 'cosmetic', before.name, after.name);
	setting(
		'description',
		'Description',
		'cosmetic',
		before.description ?? '',
		after.description ?? ''
	);

	const tabsA = layoutLabels(before);
	const tabsB = layoutLabels(after);
	if (!same(tabsA, tabsB)) {
		changes.push(
			changed('settings', 'layout', 'Layout', [['cosmetic', `${list(tabsA)} → ${list(tabsB)}`]])
		);
	}
	return changes;
}

/** Tab labels for a tabbed layout, group labels for a flat one. */
function layoutLabels(schema: UISchema): string[] {
	const layout = schema.layout;
	if (layout?.type === 'tabbed') return (layout.tabs ?? []).map((t) => t.label);
	return getGroups(schema).map((g) => g.label);
}

// ============================================================================
// Markdown
// ============================================================================

const HEADINGS: Record<SchemaChangeImpact, string> = {
	breaking: 'Breaking',
	notable: 'Changes',
	cosmetic: 'Cosmetic'
};

/** The diff as Markdown, to start a version's notes from. Empty for an identical diff. */
export function schemaDiffToMarkdown(diff: SchemaDiff): string {
	const sections: string[] = [];
	for (const impact of ['breaking', 'notable', 'cosmetic'] as const) {
		const lines = diff.changes.filter((c) => c.impact === impact).map(changeLine);
		if (lines.length) sections.push(`### ${HEADINGS[impact]}\n\n${lines.join('\n')}`);
	}
	return sections.join('\n\n');
}

/** `Removed input **Width**`, `Input **Width**: default 10 → 12`, `Preview solves: false → true`. */
function changeLine(c: SchemaChange): string {
	if (c.change !== 'changed') return `- ${capitalize(c.change)} ${c.kind} **${c.label}**`;
	const subject = c.kind === 'settings' ? c.label : `${capitalize(c.kind)} **${c.label}**`;
	return `- ${subject}: ${c.details.join('; ')}`;
}

// ============================================================================
// Helpers
// ============================================================================

function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
	return new Map((items ?? []).map((i) => [i.id, i]));
}

function whole(
	kind: SchemaChange['kind'],
	change: 'added' | 'removed',
	id: string,
	label: string,
	impact: SchemaChangeImpact
): SchemaChange {
	return { kind, change, id, label, impact, details: [] };
}

function changed(
	kind: SchemaChange['kind'],
	id: string,
	label: string,
	found: Finding[]
): SchemaChange {
	const impact = found.reduce<SchemaChangeImpact>(
		(worst, [i]) => (IMPACT_RANK[i] < IMPACT_RANK[worst] ? i : worst),
		'cosmetic'
	);
	return { kind, change: 'changed', id, label, impact, details: found.map(([, d]) => d) };
}

function same(a: unknown, b: unknown): boolean {
	return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
	if (value === undefined) return 'undefined';
	return JSON.stringify(value, (_k, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
			: v
	);
}

function show(value: unknown): string {
	if (value === undefined || value === null || value === '') return 'none';
	const text = typeof value === 'string' ? value : stableJson(value);
	return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function num(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function range(min: number | undefined, max: number | undefined): string {
	return `${min ?? '−∞'}–${max ?? '∞'}`;
}

function list(items: string[]): string {
	const shown = items.slice(0, 5).join(', ');
	return items.length > 5 ? `${shown} and ${items.length - 5} more` : shown || 'none';
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
