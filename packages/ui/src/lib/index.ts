// Layout components (page chrome: shell, header, footer, nav)
export * from './components/layout';

// Compute app (schema + viewer + solve controls composed into a runnable app)
export { default as AppLayout } from './components/compute/AppLayout.svelte';
export { default as ComputeApp } from './components/compute/ComputeApp.svelte';

// Error screen
export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// Design-system primitives (shadcn-svelte + custom)
export * from './components/primitives';
export { default as StateDisplay } from './components/primitives/StateDisplay.svelte';

// 3D viewer
export { default as Viewer } from './components/viewer/Viewer.svelte';

// Utilities
export * from './schema/defaults';
export * from './schema/dynamic-value-list';
export * from './schema/traversal';
export * from './compute/solving.svelte';

// Solve Session seam (transport-agnostic value/lifecycle state machine + its driver
// interface). Exported so transports outside this package — e.g. plugin-ui's WebSocket
// driver — can satisfy SolveDriver and drive a session. See CONTEXT.md.
export {
	createSolveSession,
	createRequestResponseDriver,
	type SolveSession,
	type SolveSessionArgs,
	type SolveDriver,
	type SolveReporter
} from './compute/createSolveSession.svelte';

// External-input transit storage (used by routes that wire pre-step producers)
export * from './external/storage';

// Contexts & Composables
export * from './contexts/footerContext.svelte';
export * from './contexts/clientSlotContext.svelte';
export * from './composables/useFooterItem.svelte';

// Utils (cn function)
export * from './utils';
export { randomId } from './utils/randomId';

// UI-specific runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn, SolveResult } from './types/solveFn';
export { DEFAULT_PRESET_LABELS, type PresetLabels } from './types/presetLabels';
