// ============================================================================
// Published public API of @selvajs/ui
// ============================================================================
//
// This is the ONLY surface npm consumers of @selvajs/ui see (package.json maps
// the "." export's `svelte`/`types` conditions at this file's build output).
//
// Scope: the compute-app SDK — everything an external host app needs to embed a
// Grasshopper-driven app (ComputeApp), drive solves, and wire pre-step
// producers. Verified against real consumers (parafa, parapet): they import
// ComputeApp + its types, the solve seam, and external/storage. Nothing else.
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

// Full-screen states a host app renders
export { default as ErrorScreen } from './components/ErrorScreen.svelte';

// Solve Session seam (transport-agnostic value/lifecycle state machine + its
// driver interface). Exported so transports outside this package can satisfy
// SolveDriver and drive a session. See CONTEXT.md.
export {
	createSolveSession,
	createRequestResponseDriver,
	type SolveSession,
	type SolveSessionArgs,
	type SolveDriver,
	type SolveReporter
} from './compute/createSolveSession.svelte';

// Client-slot context type (host apps render their own cell for client-sourced
// inputs; parafa uses ClientSlotArgs).
export type { ClientSlotArgs, ClientSlot } from './contexts/clientSlotContext.svelte';

// Pre-step producer transit storage (parafa wires producers via these).
export * from './external/storage';

// Schema utilities a ComputeApp host reasonably needs to read/shape values.
export * from './schema/defaults';
export * from './schema/traversal';
export * from './schema/dynamic-value-list';

// UI-facing runtime types (not from schema)
export type { ActionButton } from './types/actionButton';
export type { SolveFn, SolveResult } from './types/solveFn';
export { DEFAULT_PRESET_LABELS, type PresetLabels } from './types/presetLabels';
