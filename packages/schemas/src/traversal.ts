// Schema layout traversal — the single place that knows how to walk a UISchema's
// layout. The layout is a discriminated union ('tabbed' | 'flat'); without this module
// every caller re-derives the `layout.type === 'tabbed' ? tabs.flatMap(...) : groups`
// branch by hand. Add a new layout kind and you change this file, not a dozen others.
//
// Lives in @selvajs/schemas (next to the types it walks) so any package that depends on
// the schema can traverse it without pulling in @selvajs/ui. Readers are defensive: a
// missing layout or missing groups/items yields an empty result rather than throwing.

import type { UISchema, GroupConfig, LayoutItem, InputLayoutItem } from './generated/index.js';

/**
 * Every group across the schema, in tab order, with tab boundaries flattened away.
 * Callers that need the tab structure (e.g. position-based panels) must walk `layout`
 * directly — this is intentionally a group-level view.
 */
export function getGroups(schema: UISchema): GroupConfig[] {
	if (!schema?.layout) return [];
	if (schema.layout.type === 'tabbed') {
		return schema.layout.tabs?.flatMap((t) => t.groups ?? []) ?? [];
	}
	if (schema.layout.type === 'flat') {
		return schema.layout.groups ?? [];
	}
	return [];
}

/** Every layout item across every group — inputs, outputs, and linebreaks. */
export function getLayoutItems(schema: UISchema): LayoutItem[] {
	return getGroups(schema).flatMap((g) => g.items ?? []);
}

/** Only the input items. `getExternalInputs` and preset save build on this. */
export function getInputItems(schema: UISchema): InputLayoutItem[] {
	return getLayoutItems(schema).filter((i): i is InputLayoutItem => i.type === 'input');
}
