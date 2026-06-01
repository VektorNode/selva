import { getContext, setContext } from 'svelte';
import type { Snippet } from 'svelte';

// Carries the host app's slot renderer down to InputControl without threading a
// prop through every layout layer (ComputeApp → AppLayout → TabLayout →
// TabContent → Group → InputControl).
//
// An input with source.kind === 'client' and source.client.presentation === 'slot'
// reserves its cell but renders nothing itself. Instead Selva invokes this snippet
// so the host can render its own element (e.g. an "Edit JSON" button). Selva never
// interprets what the host renders; `slotLabel` is passed through untouched.

export interface ClientSlotArgs {
	/** Grasshopper parameter instance GUID (LayoutItem.paramId / SchemaInput.id). */
	inputId: string;
	displayName: string;
	/** Author-set label from the schema, passed through untouched. May be undefined. */
	slotLabel?: string;
	/** The current value held for this input (e.g. the prefilled JSON), if any. */
	value: unknown;
}

export type ClientSlot = Snippet<[ClientSlotArgs]>;

const CLIENT_SLOT_CONTEXT_KEY = Symbol('client-slot-context');

export function setClientSlot(slot: ClientSlot | undefined): void {
	setContext(CLIENT_SLOT_CONTEXT_KEY, slot);
}

export function getClientSlot(): ClientSlot | undefined {
	return getContext<ClientSlot | undefined>(CLIENT_SLOT_CONTEXT_KEY);
}
