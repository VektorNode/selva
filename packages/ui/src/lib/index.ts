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
export * from './compute/solving.svelte';

// External-input transit storage (used by routes that wire pre-step producers)
export * from './external/storage';

// Contexts & Composables
export * from './contexts/footerContext.svelte';
export * from './composables/useFooterItem.svelte';

// Utils (cn function)
export * from './utils';

// UI-specific runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn } from './types/solveFn';
