// Transit storage for inputs with source.kind === 'client': a producer route writes the
// value here, the solver route reads it back. Keyed by (scopeKey, inputId) so values
// don't bleed across solver contexts — scopeKey is whatever uniquely identifies one
// (sessionId in plugin-ui/preview, definition guid in selva/library).

import type { UISchema } from '@selvajs/schemas';
import { getInputItems } from '@selvajs/schemas';

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

export function getExternalInputs(schema: UISchema): ExternalInput[] {
	return getInputItems(schema)
		.filter((item) => item.source?.kind === 'client')
		.map((item) => ({
			paramId: item.paramId,
			displayName: item.displayName ?? item.paramId
		}));
}
