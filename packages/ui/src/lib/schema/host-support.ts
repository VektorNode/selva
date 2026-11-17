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
 * - `curve`: a Rhino Get Line, or a Get Geometry that takes curves. Rhino fills it by picking in
 *   the viewport, Selva by drawing in the viewer or importing a file.
 * - `geometry`: any other Rhino Get Geometry, Get Point or Get Plane, filled by picking in the
 *   viewport.
 * - `trigger`: a boolean input shown as a button; a press solves once with `true`.
 * - `unknown`: a layout item from a newer schema than this build knows.
 */
export type ElementKind = 'value' | 'curve' | 'geometry' | 'trigger' | 'unknown';

const SUPPORT: Record<ElementKind, readonly UIHost[]> = {
	value: ['rhino', 'selva'],
	curve: ['rhino', 'selva'],
	geometry: ['rhino'],
	trigger: ['rhino'],
	unknown: []
};

export const HOST_LABELS: Record<UIHost, string> = { rhino: 'Rhino', selva: 'Selva' };

const GEOMETRY_PARAM_TYPES: ReadonlySet<string> = new Set(['geometry', 'point', 'line', 'plane']);

type WidgetTypeOf<T extends 'input' | 'output'> = Extract<LayoutItem, { type: T }>['widgetType'];

// Keyed by the schema's own widget unions, so a widget added to the schema fails to compile here
// until someone decides which hosts render it.
const INPUT_WIDGETS = {
	number: true,
	text: true,
	dropdown: true,
	dynamicValueList: true,
	checkbox: true,
	file: true,
	color: true
} as const satisfies Record<WidgetTypeOf<'input'>, true>;
const OUTPUT_WIDGETS = {
	text: true,
	number: true,
	file: true,
	chart: true,
	image: true,
	dynamicValueList: true
} as const satisfies Record<WidgetTypeOf<'output'>, true>;

const KNOWN_WIDGETS: Record<'input' | 'output', ReadonlySet<string>> = {
	input: new Set(Object.keys(INPUT_WIDGETS)),
	output: new Set(Object.keys(OUTPUT_WIDGETS))
};

/** The control comes from this, whatever the saved widgetType says: saved ones hold `text`. */
export function isGeometryParamType(paramType: string | undefined): boolean {
	return paramType !== undefined && GEOMETRY_PARAM_TYPES.has(paramType);
}

/**
 * Whether a curve can fill the input: a Get Line, or a Get Geometry whose type filter lets curves
 * through. An empty `geometryTypes` is a filter that allows everything. An absent one is a schema
 * saved before 2.22.0, where the filter is unknown, and the input is offered rather than hidden.
 */
export function isCurveInput(
	input: Pick<SchemaInput, 'paramType' | 'geometryTypes'> | undefined
): boolean {
	if (input?.paramType === 'line') return true;
	if (input?.paramType !== 'geometry') return false;
	return !input.geometryTypes?.length || input.geometryTypes.includes('curve');
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
		const input = inputs.find((i) => i.id === item.paramId);
		if (isCurveInput(input)) return 'curve';
		if (isGeometryParamType(input?.paramType)) return 'geometry';
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
