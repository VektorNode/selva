// The in-monorepo barrel: everything public.ts publishes, plus the design system,
// page chrome, contexts and utils that never ship to npm. Reached via the
// "selva-source" export condition.

export * from './components/layout';

export { default as AppLayout } from './components/compute/AppLayout.svelte';
export { default as ComputeApp } from './components/compute/ComputeApp.svelte';

export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// Design-system primitives (shadcn-svelte + custom)
export * from './components/primitives';
export { default as StateDisplay } from './components/primitives/StateDisplay.svelte';

export { default as Viewer } from './components/viewer/Viewer.svelte';

export * from './schema/defaults';
export * from './schema/dynamic-value-list';
export * from './schema/traversal';
export * from './compute/solving.svelte';

// Solve Session seam. Re-exported so transports outside this package — e.g.
// plugin-ui's WebSocket driver — can satisfy SolveDriver and drive a session.
// See CONTEXT.md.
export { useSolveSession } from './compute/useSolveSession.svelte';
export {
	createSolveSession,
	createRequestResponseDriver,
	type SolveSession,
	type SolveSessionArgs,
	type SolveDriver,
	type SolveReporter
} from '@selvajs/solve/client';

// Pre-step producer transit storage
export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs,
	type ExternalValueRef,
	type ExternalInput
} from '@selvajs/solve/client';

export * from './contexts/footerContext.svelte';
export * from './contexts/clientSlotContext.svelte';
export * from './composables/useFooterItem.svelte';

export * from './utils';
export { randomId } from './utils/randomId';

// UI-specific runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn, SolveResult } from '@selvajs/solve/shared';
export { DEFAULT_PRESET_LABELS, type PresetLabels } from './types/presetLabels';
