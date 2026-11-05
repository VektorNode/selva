// Transit storage for inputs with source.kind === 'client': a producer route writes the
// value here, the solver route reads it back. Keyed by (scopeKey, inputId) so values
// don't bleed across solver contexts — scopeKey is whatever uniquely identifies one.

import type { UISchema } from '@selvajs/schemas';
import { getInputItems } from '@selvajs/schemas';

const STORAGE_PREFIX = 'external';

export interface ExternalValueRef {
	scopeKey: string;
	inputId: string;
}

/** Null without a usable store. Merely reading `sessionStorage` throws when the browser blocks it. */
function openSlot(ref: ExternalValueRef): { storage: Storage; key: string } | null {
	if (!ref.scopeKey || !ref.inputId) return null;
	try {
		if (typeof sessionStorage === 'undefined') return null;
		return {
			storage: sessionStorage,
			key: `${STORAGE_PREFIX}:${ref.scopeKey}:${ref.inputId}`
		};
	} catch {
		return null;
	}
}

export function writeExternalValue(args: ExternalValueRef & { value: unknown }): void {
	const slot = openSlot(args);
	if (!slot) return;
	try {
		slot.storage.setItem(slot.key, JSON.stringify(args.value));
	} catch (err) {
		// Over quota. The input then reads as missing, which the panel reports.
		console.warn('[Solve/storage] could not store an external value:', err);
	}
}

export function readExternalValue(ref: ExternalValueRef): unknown | undefined {
	const slot = openSlot(ref);
	if (!slot) return undefined;
	const raw = slot.storage.getItem(slot.key);
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function clearExternalValue(ref: ExternalValueRef): void {
	const slot = openSlot(ref);
	slot?.storage.removeItem(slot.key);
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
