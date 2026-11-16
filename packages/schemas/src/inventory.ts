// What a .gh holds beyond its form, and what changed in it: the plugins, components, values set on
// the canvas, scripts and wiring that the form diff cannot see. The inventory itself comes from the
// plugin on Compute (`DocumentInventory` in wire-schema.json); everything here is pure.
//
// Objects match by InstanceGuid, as in the form diff. Script source is never in the inventory:
// only per-line hashes, which are enough to count added and removed lines.

import type { DocumentInventory, InventoryValue } from './generated/index.js';

// ============================================================================
// Warnings about one file
// ============================================================================

export type InventoryWarning =
	| { kind: 'missingPlugin'; plugin: string; version: string }
	| { kind: 'pluginVersion'; plugin: string; version: string; serverVersion: string }
	| { kind: 'obsolete'; component: string; plugin: string | null; count: number }
	| { kind: 'secret'; in: 'script' | 'value'; label: string; rules: string[] };

/** Missing plugins first: they are the ones that make solves fail. */
export function inventoryWarnings(inventory: DocumentInventory): InventoryWarning[] {
	const warnings: InventoryWarning[] = [];
	const pluginName = new Map(inventory.libraries.map((l) => [l.id, l.name]));

	for (const lib of inventory.libraries) {
		if (lib.core) continue;
		if (!lib.serverVersion) {
			warnings.push({ kind: 'missingPlugin', plugin: lib.name, version: lib.version });
		} else if (lib.serverVersion !== lib.version) {
			warnings.push({
				kind: 'pluginVersion',
				plugin: lib.name,
				version: lib.version,
				serverVersion: lib.serverVersion
			});
		}
	}

	const obsolete = new Map<string, { plugin: string | null; count: number }>();
	for (const c of inventory.components) {
		if (!c.obsolete) continue;
		const entry = obsolete.get(c.name) ?? {
			plugin: (c.library && pluginName.get(c.library)) || null,
			count: 0
		};
		entry.count += 1;
		obsolete.set(c.name, entry);
	}
	for (const [component, { plugin, count }] of obsolete) {
		warnings.push({ kind: 'obsolete', component, plugin, count });
	}

	for (const s of inventory.scripts) {
		if (s.secrets.length)
			warnings.push({ kind: 'secret', in: 'script', label: s.label, rules: s.secrets });
	}
	for (const v of inventory.values) {
		if (v.secrets?.length)
			warnings.push({ kind: 'secret', in: 'value', label: v.label, rules: v.secrets });
	}
	return warnings;
}

export function inventoryWarningText(w: InventoryWarning): string {
	switch (w.kind) {
		case 'missingPlugin':
			return `${w.plugin} ${w.version} is not installed on the Compute server: its components are dropped and solves miss their outputs.`;
		case 'pluginVersion':
			return `Saved with ${w.plugin} ${w.version}; the Compute server runs ${w.serverVersion}.`;
		case 'obsolete':
			return `${w.count > 1 ? `${w.count}× ` : ''}${w.component}${w.plugin ? ` (${w.plugin})` : ''} is obsolete. Open and re-save the file in Grasshopper to upgrade it.`;
		case 'secret':
			return `${w.in === 'script' ? 'Script' : 'Value'} "${w.label}" looks like it holds a secret (${w.rules.join(', ')}). Anyone who can download the file can read it.`;
	}
}

/** What the version list shows without loading the inventory. */
export interface InventorySummary {
	/** Plugins the file needs that the Compute server had not loaded at the last check. */
	missingPlugins: string[];
	obsoleteComponents: number;
}

export function summarizeInventory(inventory: DocumentInventory): InventorySummary {
	return {
		missingPlugins: inventory.libraries
			.filter((l) => !l.core && !l.serverVersion)
			.map((l) => l.name),
		obsoleteComponents: inventory.components.filter((c) => c.obsolete).length
	};
}

// ============================================================================
// What changed between two files
// ============================================================================

export interface PluginChange {
	plugin: string;
	change: 'added' | 'removed' | 'changed';
	before?: string;
	after?: string;
}

export interface ComponentCount {
	name: string;
	count: number;
}

export interface ScriptChange {
	id: string;
	label: string;
	language: string;
	change: 'added' | 'removed' | 'changed';
	linesAdded: number;
	linesRemoved: number;
}

export interface ValueChange {
	id: string;
	label: string;
	kind: InventoryValue['kind'];
	/** Text as stored: cut at 500 characters, and `null` where it looked like a secret. */
	before: string | null;
	after: string | null;
	/** Slider range, when it changed. */
	range?: { before: string; after: string };
}

export interface InventoryDiff {
	plugins: PluginChange[];
	components: { added: ComponentCount[]; removed: ComponentCount[] };
	scripts: ScriptChange[];
	values: ValueChange[];
	wires: { before: number; after: number; changed: boolean };
	identical: boolean;
}

export interface InventoryDiffOptions {
	/**
	 * Ids of form inputs. Their values are the form diff's to report, so values on those objects,
	 * or on their input parameters, are left out here.
	 */
	formIds?: Iterable<string>;
}

export function diffInventories(
	before: DocumentInventory,
	after: DocumentInventory,
	options: InventoryDiffOptions = {}
): InventoryDiff {
	const formIds = new Set([...(options.formIds ?? [])].map((id) => id.toLowerCase()));
	const plugins = diffPlugins(before, after);
	const components = diffComponents(before, after);
	const scripts = diffScripts(before, after);
	const values = diffValues(before, after, formIds);
	const wires = {
		before: before.wires.count,
		after: after.wires.count,
		changed: before.wires.sha256 !== after.wires.sha256
	};
	return {
		plugins,
		components,
		scripts,
		values,
		wires,
		identical:
			!plugins.length &&
			!components.added.length &&
			!components.removed.length &&
			!scripts.length &&
			!values.length &&
			!wires.changed
	};
}

function diffPlugins(before: DocumentInventory, after: DocumentInventory): PluginChange[] {
	const key = (l: { id: string; name: string }) =>
		/^0{8}-/.test(l.id) ? `name:${l.name}` : l.id.toLowerCase();
	const old = new Map(before.libraries.map((l) => [key(l), l]));
	const now = new Map(after.libraries.map((l) => [key(l), l]));
	const changes: PluginChange[] = [];
	for (const [k, l] of now) {
		const prev = old.get(k);
		if (!prev) changes.push({ plugin: l.name, change: 'added', after: l.version });
		else if (prev.version !== l.version)
			changes.push({ plugin: l.name, change: 'changed', before: prev.version, after: l.version });
	}
	for (const [k, l] of old) {
		if (!now.has(k)) changes.push({ plugin: l.name, change: 'removed', before: l.version });
	}
	return changes;
}

function diffComponents(before: DocumentInventory, after: DocumentInventory) {
	const oldIds = new Set(before.components.map((c) => c.id.toLowerCase()));
	const newIds = new Set(after.components.map((c) => c.id.toLowerCase()));
	const countBy = (list: DocumentInventory['components'], skip: Set<string>) => {
		const counts = new Map<string, number>();
		for (const c of list) {
			if (!skip.has(c.id.toLowerCase())) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
		}
		return [...counts]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	};
	return { added: countBy(after.components, oldIds), removed: countBy(before.components, newIds) };
}

function diffScripts(before: DocumentInventory, after: DocumentInventory): ScriptChange[] {
	const old = new Map(before.scripts.map((s) => [s.id.toLowerCase(), s]));
	const now = new Map(after.scripts.map((s) => [s.id.toLowerCase(), s]));
	const changes: ScriptChange[] = [];
	for (const [id, s] of now) {
		const prev = old.get(id);
		if (!prev) {
			changes.push({ ...scriptRef(s), change: 'added', linesAdded: s.lineCount, linesRemoved: 0 });
		} else if (prev.sha256 !== s.sha256) {
			const { added, removed } = countLineChanges(prev.lineHashes, s.lineHashes);
			changes.push({
				...scriptRef(s),
				change: 'changed',
				linesAdded: added,
				linesRemoved: removed
			});
		}
	}
	for (const [id, s] of old) {
		if (!now.has(id))
			changes.push({
				...scriptRef(s),
				change: 'removed',
				linesAdded: 0,
				linesRemoved: s.lineCount
			});
	}
	return changes;
}

const scriptRef = (s: DocumentInventory['scripts'][number]) => ({
	id: s.id,
	label: s.label,
	language: s.language
});

function diffValues(
	before: DocumentInventory,
	after: DocumentInventory,
	formIds: Set<string>
): ValueChange[] {
	const onForm = (v: InventoryValue) =>
		formIds.has(v.id.toLowerCase()) || (!!v.owner && formIds.has(v.owner.toLowerCase()));
	const old = new Map(before.values.map((v) => [v.id.toLowerCase(), v]));
	const changes: ValueChange[] = [];
	// Values added or removed come and go with their components, which the counts already show.
	for (const v of after.values) {
		const prev = old.get(v.id.toLowerCase());
		if (!prev || onForm(v)) continue;
		const range =
			prev.min !== v.min || prev.max !== v.max
				? { before: `${prev.min ?? ''}–${prev.max ?? ''}`, after: `${v.min ?? ''}–${v.max ?? ''}` }
				: undefined;
		if (prev.sha256 === v.sha256 && !range) continue;
		changes.push({
			id: v.id,
			label: v.label,
			kind: v.kind,
			before: prev.secrets?.length ? null : prev.text,
			after: v.secrets?.length ? null : v.text,
			...(range && { range })
		});
	}
	return changes;
}

// ============================================================================
// Line diff
// ============================================================================

export type LineOp = { op: 'same' | 'add' | 'remove'; text: string };

/** Above this many cells the middle is compared as a multiset: close enough for a count. */
const LCS_CELL_LIMIT = 4_000_000;

/** Lines added and removed between two sequences, by LCS. Works on hashes or text alike. */
export function countLineChanges(
	before: readonly string[],
	after: readonly string[]
): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const op of lineOps(before, after)) {
		if (op.op === 'add') added++;
		else if (op.op === 'remove') removed++;
	}
	return { added, removed };
}

/** A line-by-line diff of two texts, for showing a script change. */
export function diffLines(before: string, after: string): LineOp[] {
	const split = (s: string) => {
		const lines = s.replace(/\r\n?/g, '\n').split('\n');
		while (lines.length && !lines.at(-1)!.trim()) lines.pop();
		return lines;
	};
	return lineOps(split(before), split(after));
}

function lineOps(a: readonly string[], b: readonly string[]): LineOp[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	const head = a.slice(0, start).map((text) => ({ op: 'same' as const, text }));
	const tail = a.slice(endA).map((text) => ({ op: 'same' as const, text }));
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);

	const middle =
		midA.length * midB.length > LCS_CELL_LIMIT ? multisetOps(midA, midB) : lcsOps(midA, midB);
	return [...head, ...middle, ...tail];
}

function lcsOps(a: readonly string[], b: readonly string[]): LineOp[] {
	const n = a.length;
	const m = b.length;
	// lengths[i][j] = LCS of a[i..] and b[j..], flattened.
	const lengths = new Uint32Array((n + 1) * (m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lengths[i * (m + 1) + j] =
				a[i] === b[j]
					? lengths[(i + 1) * (m + 1) + j + 1] + 1
					: Math.max(lengths[(i + 1) * (m + 1) + j], lengths[i * (m + 1) + j + 1]);
		}
	}
	const ops: LineOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({ op: 'same', text: a[i] });
			i++;
			j++;
		} else if (lengths[(i + 1) * (m + 1) + j] >= lengths[i * (m + 1) + j + 1]) {
			ops.push({ op: 'remove', text: a[i++] });
		} else {
			ops.push({ op: 'add', text: b[j++] });
		}
	}
	while (i < n) ops.push({ op: 'remove', text: a[i++] });
	while (j < m) ops.push({ op: 'add', text: b[j++] });
	return ops;
}

function multisetOps(a: readonly string[], b: readonly string[]): LineOp[] {
	const left = new Map<string, number>();
	for (const line of b) left.set(line, (left.get(line) ?? 0) + 1);
	const ops: LineOp[] = [];
	for (const line of a) {
		const n = left.get(line) ?? 0;
		if (n > 0) left.set(line, n - 1);
		else ops.push({ op: 'remove', text: line });
	}
	const kept = new Map<string, number>();
	for (const line of a) kept.set(line, (kept.get(line) ?? 0) + 1);
	for (const line of b) {
		const n = kept.get(line) ?? 0;
		if (n > 0) kept.set(line, n - 1);
		else ops.push({ op: 'add', text: line });
	}
	return ops;
}

// ============================================================================
// Release notes
// ============================================================================

/** "Inside the definition" as Markdown list items, for release notes. Empty when identical. */
export function inventoryDiffToMarkdown(diff: InventoryDiff): string {
	const lines: string[] = [];
	for (const p of diff.plugins) {
		lines.push(
			p.change === 'added'
				? `- Uses ${p.plugin} ${p.after}`
				: p.change === 'removed'
					? `- No longer uses ${p.plugin}`
					: `- ${p.plugin} ${p.before} → ${p.after}`
		);
	}
	const counts = (list: ComponentCount[], sign: string) =>
		list.map((c) => `${sign}${c.count > 1 ? `${c.count} ` : ''}${c.name}`).join(', ');
	if (diff.components.added.length)
		lines.push(`- Components added: ${counts(diff.components.added, '+')}`);
	if (diff.components.removed.length)
		lines.push(`- Components removed: ${counts(diff.components.removed, '−')}`);
	for (const s of diff.scripts) {
		lines.push(
			s.change === 'changed'
				? `- Script **${s.label}** edited (+${s.linesAdded} −${s.linesRemoved} lines)`
				: `- Script **${s.label}** ${s.change}`
		);
	}
	for (const v of diff.values) {
		const text = (t: string | null) => (t === null ? '(hidden)' : `\`${oneLine(t)}\``);
		lines.push(`- **${v.label}** ${text(v.before)} → ${text(v.after)}`);
	}
	if (diff.wires.changed && !lines.length) lines.push('- Wiring changed');
	return lines.join('\n');
}

const oneLine = (text: string) => {
	const line = text.replace(/\s+/g, ' ').replace(/`/g, "'").trim();
	return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};
