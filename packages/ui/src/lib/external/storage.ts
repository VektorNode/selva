// Client-supplied input transit storage.
//
// When an input has source.kind === 'client', a producer route writes the produced
// value here, and the solver route reads it back. Scoped per (scopeKey, inputId) so
// values for one solver/input don't bleed into another. The scope key is whatever
// uniquely identifies the solver context — sessionId in plugin-ui/preview,
// definition guid in selva/library, etc.
//
// inputId is the Grasshopper parameter instance GUID (LayoutItem.paramId / SchemaInput.id).

import type { UISchema, LayoutItem, GroupConfig, InputSource } from '@selvajs/schemas';

const STORAGE_PREFIX = 'external';

function makeKey(scopeKey: string, inputId: string): string {
	return `${STORAGE_PREFIX}:${scopeKey}:${inputId}`;
}

export interface ExternalValueRef {
	scopeKey: string;
	inputId: string;
}

export function writeExternalValue(args: ExternalValueRef & { value: unknown }): void {
	const { scopeKey, inputId, value } = args;
	if (!scopeKey || !inputId) return;
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(makeKey(scopeKey, inputId), JSON.stringify(value));
}

export function readExternalValue(ref: ExternalValueRef): unknown | undefined {
	const { scopeKey, inputId } = ref;
	if (!scopeKey || !inputId) return undefined;
	if (typeof sessionStorage === 'undefined') return undefined;
	const raw = sessionStorage.getItem(makeKey(scopeKey, inputId));
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function clearExternalValue(ref: ExternalValueRef): void {
	const { scopeKey, inputId } = ref;
	if (!scopeKey || !inputId) return;
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(makeKey(scopeKey, inputId));
}

export interface ExternalInput {
	paramId: string;
	displayName: string;
}

function* walkLayoutItems(schema: UISchema): Generator<LayoutItem> {
	const groups: GroupConfig[] =
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.flatMap((t) => t.groups)
			: schema.layout.groups;
	for (const group of groups) {
		for (const item of group.items) {
			yield item;
		}
	}
}

export function getExternalInputs(schema: UISchema): ExternalInput[] {
	const result: ExternalInput[] = [];
	for (const item of walkLayoutItems(schema)) {
		if (item.type !== 'input') continue;
		const source = (item as { source?: InputSource }).source;
		if (source?.kind !== 'client') continue;
		result.push({
			paramId: item.paramId,
			displayName: item.displayName ?? item.paramId
		});
	}
	return result;
}
