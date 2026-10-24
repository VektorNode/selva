// Which elements of a schema each host renders. Worked out from the schema on every read and
// never stored in it: a stored copy goes stale the way a saved paramType does. Making an element
// work on Selva later is a change to SUPPORT, with no schema change and no migration.

import type {
	InputLayoutItem,
	LayoutItem,
	SchemaInput,
	UISchema,
	CheckboxWidgetConfig
} from '@selvajs/schemas';
import { getGroups } from '@selvajs/schemas';

/**
 * Where a UI runs: `rhino` is the plugin's page inside Rhino, solving in the user's own
 * Grasshopper; `selva` is the Selva app, solving headless on Rhino.Compute.
 */
export type UIHost = 'rhino' | 'selva';

/**
 * - `value`: an input or output every host renders.
 * - `geometry`: a Rhino Get Geometry/Point/Line/Plane input, filled by picking in the viewport.
 * - `trigger`: a boolean input shown as a button; a press solves once with `true`.
 * - `unknown`: a layout item from a newer schema than this build knows.
 */
export type ElementKind = 'value' | 'geometry' | 'trigger' | 'unknown';

const SUPPORT: Record<ElementKind, readonly UIHost[]> = {
	value: ['rhino', 'selva'],
	geometry: ['rhino'],
	trigger: ['rhino'],
	unknown: []
};

export const HOST_LABELS: Record<UIHost, string> = { rhino: 'Rhino', selva: 'Selva' };

const GEOMETRY_PARAM_TYPES: ReadonlySet<string> = new Set(['geometry', 'point', 'line', 'plane']);

const KNOWN_WIDGETS: Record<'input' | 'output', ReadonlySet<string>> = {
	input: new Set(['number', 'text', 'dropdown', 'dynamicValueList', 'checkbox', 'file', 'color']),
	output: new Set(['text', 'number', 'file', 'chart', 'image', 'dynamicValueList'])
};

/** The control comes from this, whatever the saved widgetType says: saved ones hold `text`. */
export function isGeometryParamType(paramType: string | undefined): boolean {
	return paramType !== undefined && GEOMETRY_PARAM_TYPES.has(paramType);
}

export function isTriggerItem(item: LayoutItem): boolean {
	return (
		item.type === 'input' &&
		item.widgetType === 'checkbox' &&
		(item.config as CheckboxWidgetConfig | undefined)?.displayAs === 'button'
	);
}

export function layoutItemKind(item: LayoutItem, inputs: readonly SchemaInput[]): ElementKind {
	if (item.type === 'linebreak') return 'value';
	if (item.type !== 'input' && item.type !== 'output') return 'unknown';
	if (item.type === 'input') {
		const paramType = inputs.find((i) => i.id === item.paramId)?.paramType;
		if (isGeometryParamType(paramType)) return 'geometry';
	}
	if (!KNOWN_WIDGETS[item.type].has(item.widgetType)) return 'unknown';
	return isTriggerItem(item) ? 'trigger' : 'value';
}

export function hostsFor(kind: ElementKind): readonly UIHost[] {
	return SUPPORT[kind];
}

export function isSupportedOn(host: UIHost, kind: ElementKind): boolean {
	return SUPPORT[kind].includes(host);
}

/**
 * Inputs the form keeps no value for: geometry lives on the Grasshopper param after a pick, and a
 * button only sends a press. Value updates and presets skip them; holding a button's `true` would
 * fire its action again on every solve.
 */
export function isValuelessInput(item: InputLayoutItem, input: SchemaInput | undefined): boolean {
	return isGeometryParamType(input?.paramType) || isTriggerItem(item);
}

export function valuelessInputIds(schema: UISchema): Set<string> {
	const ids = new Set<string>();
	for (const input of schema.inputs) {
		if (isGeometryParamType(input.paramType)) ids.add(input.id);
	}
	for (const group of getGroups(schema)) {
		for (const item of group.items ?? []) {
			if (isTriggerItem(item)) ids.add((item as InputLayoutItem).paramId);
		}
	}
	return ids;
}

/** The placed items a host won't render, for the builder's summary of where the UI runs. */
export function unsupportedItems(schema: UISchema, host: UIHost): LayoutItem[] {
	const items: LayoutItem[] = [];
	for (const group of getGroups(schema)) {
		for (const item of group.items ?? []) {
			if (!isSupportedOn(host, layoutItemKind(item, schema.inputs))) items.push(item);
		}
	}
	return items;
}
