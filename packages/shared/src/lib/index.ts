// Layout components
export { default as PageContainer } from './components/layout/PageContainer.svelte';
export { default as PageHeader } from './components/layout/PageHeader.svelte';
export { default as PageContent } from './components/layout/PageContent.svelte';
export { default as PageFooter } from './components/layout/PageFooter.svelte';
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

// Re-export types from generated schema
export type * from './types/generated';
export type { ActionButton } from './types/actionButton';
export type { SolveFn } from './types/solveFn';

// Re-export constants from generated schema
export { ACCEPTED_FILE_FORMATS } from './types/generated/schema';
