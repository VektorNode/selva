import type { SolveSettlement } from '@selvajs/solve/client';
import type { ActionButton } from '../types/actionButton';

/**
 * Runs a footer-menu action. A `solvesFirst` action waits for the result for the current
 * inputs and runs only on an applied one; a refused or failed solve has already shown the user
 * why. A host that can't solve (`ensureSolved` undefined) runs it straight away.
 */
export async function runPanelAction(
	action: ActionButton,
	ensureSolved: (() => Promise<SolveSettlement>) | undefined
): Promise<void> {
	if (!action.solvesFirst || !ensureSolved) return action.onclick();
	const settled = await ensureSolved();
	if (settled.status === 'applied') await action.onclick(settled);
}
