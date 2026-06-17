import { getContext, setContext } from 'svelte';
import type { Snippet } from 'svelte';
import type { SupportedTypes } from '@selvajs/schemas';

// Carries the host app's slot renderer down to InputControl without threading a
// prop through every layout layer (ComputeApp → AppLayout → TabLayout →
// TabContent → Group → InputControl).
//
// An input with source.kind === 'client' and source.client.presentation === 'slot'
// reserves its cell but renders nothing itself. Instead Selva invokes this snippet
// so the host can render its own element (e.g. an "Edit JSON" button, or a custom
// picker). Selva never interprets what the host renders. The host may COMMIT a value
// back via `onValueChange`, which flows into the solve exactly like any built-in
// widget's change.

export interface ClientSlotArgs {
	/** Grasshopper parameter instance GUID (LayoutItem.paramId / SchemaInput.id). */
	inputId: string;
	displayName: string;
	/** The current value held for this input (e.g. the prefilled JSON), if any. */
	value: unknown;
	/**
	 * Commit a value for this input. Identical channel to a built-in widget's change
	 * — the value lands in the solve session and is sent to Compute on the next solve.
	 * `forceSolve` requests a solve even in manual-solve mode (system reconciliation).
	 * Lets a slot be an interactive control (a custom picker), not just a display cell.
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
