// ============================================================================
// Published public API of @selvajs/ui
// ============================================================================
//
// This is the ONLY surface npm consumers of @selvajs/ui see (package.json maps
// the "." export's `svelte`/`types` conditions at this file's build output).
//
// Scope: the compute-app SDK — everything an external host app needs to embed a
// Grasshopper-driven app (ComputeApp), drive solves, and wire pre-step
// producers. Verified against real external host apps: they import
// ComputeApp + its types, the solve seam, and the external-input storage
// helpers. Nothing else.
//
// Deliberately NOT public: design-system primitives (Button, Card, Dialog, …),
// page-chrome layout (AppShell, SideNav, …), toast/Toaster, ThemeSwitcher,
// DataTable, contexts/composables, cn/randomId. These remain importable from
// the full barrel (./index.ts) INSIDE the monorepo via the "@selvajs/source"
// export condition, but never ship to npm. If an external consumer ever needs a
// primitive directly, promote it here explicitly rather than re-exporting the
// whole primitives barrel.

// Compute app (schema + viewer + solve controls composed into a runnable app)
export { default as AppLayout } from './components/compute/AppLayout.svelte';
export { default as ComputeApp } from './components/compute/ComputeApp.svelte';

// Standalone 3D viewer. Render Grasshopper meshes on their own, outside a
// ComputeApp host — external apps drive it directly with a `meshes` array and
// an optional `viewerConfig`. Pass `lang` to localize its chrome, or provide a
// locale context (setLocaleContext) at the host root to drive it app-wide.
export { default as Viewer, type ViewerConfig } from './components/viewer/Viewer.svelte';

// Viewer app seam. `onViewerReady` (on <Viewer> and <ComputeApp>) hands over the
// live three.js viewer, so a host can draw its own content into the same scene as
// the solve results — a point cloud, draft lines, annotations — and register
// pointer tools that claim clicks ahead of object selection. Re-exported from
// @selvajs/visualization/render so hosts can annotate without depending on it
// directly; `three` stays a peer dep of that package either way.
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

// Viewer localization. The library renders English + German chrome; switch at
// runtime by passing `lang` to <Viewer> or by setting a reactive locale context
// once at the host root (e.g. feed in an app-wide Paraglide locale). Does not
// translate Grasshopper-sourced names/metadata.
export type { Locale, ViewerMessages } from './i18n/messages';
export { VIEWER_MESSAGES, DEFAULT_LOCALE, messagesFor } from './i18n/messages';
export {
	setLocaleContext,
	getLocaleContext,
	type LocaleContext
} from './i18n/localeContext.svelte';

// Full-screen states a host app renders
export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// Solve Session seam (transport-agnostic value/lifecycle state machine + its
// driver interface). The session lives in `@selvajs/solve/client` and is
// framework-free; `useSolveSession` is the Svelte binding that makes its getters
// read reactively inside components. A host embedding <ComputeApp> needs neither —
// both are re-exported for hosts driving a session themselves. See CONTEXT.md.
export { useSolveSession } from './compute/useSolveSession.svelte';
export {
	createSolveSession,
	createRequestResponseDriver,
	type SolveSession,
	type SolveSessionArgs,
	type SolveDriver,
	type SolveReporter
} from '@selvajs/solve/client';

// Client-slot context type (host apps render their own cell for client-sourced
// inputs, and may commit a value back via ClientSlotArgs.onValueChange).
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

// Schema utilities a ComputeApp host reasonably needs to read/shape values.
export * from './schema/defaults';
export * from './schema/traversal';
export * from './schema/dynamic-value-list';

// UI-facing runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn, SolveResult } from '@selvajs/solve/shared';
export { DEFAULT_PRESET_LABELS, type PresetLabels } from './types/presetLabels';
