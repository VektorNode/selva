import { getContext, setContext } from 'svelte';
import type { Snippet } from 'svelte';
import type { SupportedTypes } from '@selvajs/schemas';

// Carries the host app's slot renderer down to InputControl without threading a
// prop through every layout layer.
//
// An input with source.kind === 'client' and source.client.presentation === 'slot'
// reserves its cell but renders nothing itself. Selva invokes this snippet instead so
// the host can render its own element (an "Edit JSON" button, a custom picker) and
// never interprets what comes back.

export interface ClientSlotArgs {
	/** Grasshopper parameter instance GUID (LayoutItem.paramId / SchemaInput.id). */
	inputId: string;
	displayName: string;
	value: unknown;
	/**
	 * Commit a value for this input: the same channel a built-in widget's change uses, so a
	 * slot can be an interactive control rather than just a display cell. `forceSolve`
	 * requests a solve even in manual-solve mode.
	 */
	onValueChange: (value: SupportedTypes, forceSolve?: boolean) => void;
}

export type ClientSlot = Snippet<[ClientSlotArgs]>;

const CLIENT_SLOT_CONTEXT_KEY = Symbol('client-slot-context');

export function setClientSlot(slot: ClientSlot | undefined): void {
	setContext(CLIENT_SLOT_CONTEXT_KEY, slot);
}

export function getClientSlot(): ClientSlot | undefined {
	return getContext<ClientSlot | undefined>(CLIENT_SLOT_CONTEXT_KEY);
}
