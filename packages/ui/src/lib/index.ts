// Layout components
export * from './components/layout';
// App shell (compose schema + viewer + layout into a runnable app)
export { default as AppLayout } from './components/app-shell/AppLayout.svelte';
export { default as ComputeApp } from './components/app-shell/ComputeApp.svelte';

// Error components
export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// UI components
export * from './components/ui';
export { default as StateDisplay } from './components/ui/StateDisplay.svelte';
export { default as Viewer } from './components/viewer/Viewer.svelte';

// Utilities
export * from './utils/utils-shared';
export * from './utils/solving.svelte';

// Contexts & Composables
export * from './contexts/footerContext.svelte';
export * from './composables/useFooterItem.svelte';

// Utils (cn function)
export * from './utils';

// UI-specific runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn } from './types/solveFn';
