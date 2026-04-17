// Layout components
export { default as PageContainer } from './components/layout/PageContainer.svelte';
export { default as PageHeader } from './components/layout/PageHeader.svelte';
export { default as PageFooter } from './components/layout/PageFooter.svelte';
export { default as AppLayout } from './components/AppLayout.svelte';
export { default as ComputeApp } from './components/ComputeApp.svelte';

// Constants
export { APP_DEFAULTS } from './constants';

// Error components
export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// Preview components
export { default as TabLayout } from './components/preview/TabLayout.svelte';
export { default as InputControl } from './components/preview/InputControl.svelte';
export { default as OutputDisplay } from './components/preview/OutputDisplay.svelte';

// UI components
export * from './components/ui';
export { default as StateDisplay } from './components/ui/StateDisplay.svelte';
export { default as StateManager } from './components/StateManager.svelte';
export { default as Viewer } from './components/viewer/Viewer.svelte';
export { default as SolvingIndicator } from './components/ui/SolvingIndicator.svelte';
export { default as ComputeMessages } from './components/ComputeMessages.svelte';

// Features - Preview handlers
export * from './features/preview/handlers';
export * from './features/preview/notifications';

// Utilities
export * from './utils/color';
export * from './utils/debounce';
export * from './utils/utils-shared';
export * from './utils/file-download';
export * from './utils/param-exporter';
export * from './utils/solving.svelte';
export * from './utils/computeThrottle.svelte';

// Contexts & Composables
export * from './contexts/footerContext.svelte';
export * from './composables/useFooterItem.svelte';

// Theme
export { themeStore } from './theme/themeStore.svelte';
export type { Theme } from './theme/themes';

// Utils (cn function)
export * from './utils';

// Re-export types from generated schema
export type * from './types/generated';
export type { ActionButton } from './types/actionButton';
export type { SolveFn } from './types/solveFn';

// Re-export constants from generated schema
export { ACCEPTED_FILE_FORMATS } from './types/generated/schema';

// Theme utilities
