// The only surface npm consumers of @selvajs/ui see. package.json maps the "."
// export's `svelte`/`types` conditions at this file's build output.
//
// Design-system primitives, page chrome, toasts, DataTable, contexts and small
// utils stay out on purpose: they remain importable from ./index.ts inside the
// monorepo via the "selva-source" export condition, but never ship to npm.
// Promote a symbol here explicitly rather than re-exporting a whole barrel.

// Compute app: schema + viewer + solve controls composed into a runnable app.
export { default as AppLayout } from './components/compute/AppLayout.svelte';
export { default as ComputeApp } from './components/compute/ComputeApp.svelte';

// Standalone 3D viewer: renders Grasshopper meshes outside a ComputeApp host,
// driven directly with a `meshes` array and an optional `viewerConfig`.
export { default as Viewer, type ViewerConfig } from './components/viewer/Viewer.svelte';

// `onViewerReady` (on <Viewer> and <ComputeApp>) hands over the live three.js
// viewer, so a host can draw into the same scene as the solve results and
// register pointer tools that claim clicks ahead of object selection.
// Re-exported from @selvajs/visualization/render so hosts can annotate without
// depending on it directly; `three` stays a peer dep of that package either way.
export type {
	ThreeViewer,
	PointerTool,
	ToolRegistry,
	ToolRegistration,
	LabelLayer,
	LabelHandle,
	CameraController,
	ViewPreset
} from '@selvajs/visualization/render';
export { appSource, isHostOwned, isOwnedBy, pointerToNdc } from '@selvajs/visualization/render';

// Viewer localization: English + German chrome, switched by passing `lang` to
// <Viewer> or by setting a reactive locale context once at the host root.
// Does not translate Grasshopper-sourced names/metadata.
export type { Locale, ViewerMessages } from './i18n/messages';
export { VIEWER_MESSAGES, DEFAULT_LOCALE, messagesFor } from './i18n/messages';
export {
	setLocaleContext,
	getLocaleContext,
	type LocaleContext
} from './i18n/localeContext.svelte';

// Full-screen states a host app renders.
export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// Solve Session seam, for hosts driving a session themselves rather than
// embedding <ComputeApp>. The session lives in `@selvajs/solve/client` and is
// framework-free; `useSolveSession` is the Svelte binding that makes its getters
// read reactively inside components. See CONTEXT.md.
export { useSolveSession } from './compute/useSolveSession.svelte';
export {
	createSolveSession,
	createRequestResponseDriver,
	type SolveSession,
	type SolveSessionArgs,
	type SolveDriver,
	type SolveReporter
} from '@selvajs/solve/client';

// Client-slot context: host apps render their own cell for client-sourced inputs,
// and may commit a value back via ClientSlotArgs.onValueChange.
export type { ClientSlotArgs, ClientSlot } from './contexts/clientSlotContext.svelte';

// Pre-step producer transit storage (host apps wire producers via these).
export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs,
	type ExternalValueRef,
	type ExternalInput
} from '@selvajs/solve/client';

// Schema utilities a ComputeApp host needs to read/shape values.
export * from './schema/defaults';
export * from './schema/traversal';
export * from './schema/dynamic-value-list';

// UI-facing runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn, SolveResult } from '@selvajs/solve/shared';
export { DEFAULT_PRESET_LABELS, type PresetLabels } from './types/presetLabels';
