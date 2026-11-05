import type { SolveSettlement } from '@selvajs/solve/client';

/** A host action, listed in the panel footer's ⋯ menu after saving and loading inputs. */
export interface ActionButton {
	id: string;
	label: string;
	/** A Svelte component, rendered before the label. */
	icon?: any;
	variant?: 'default' | 'destructive';
	/** Shows the action as unavailable instead of hiding it. Pair it with a `hint` saying why. */
	disabled?: boolean;
	/** A short line under the label: why it is disabled, or what it does. */
	hint?: string;
	/**
	 * The action needs the result for the current inputs: picking it solves first when inputs
	 * changed, waits for a solve that is running or under review, and runs `onclick` only if
	 * that solve is applied. `onclick` then receives it. A refused or failed solve already shows
	 * its messages, so the action just doesn't run.
	 */
	solvesFirst?: boolean;
	onclick: (settled?: Extract<SolveSettlement, { status: 'applied' }>) => void | Promise<void>;
}
