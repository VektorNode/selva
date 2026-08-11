// Pure, framework-free transition logic for the builder state (mirrors the Solve Session
// split in @selvajs/ui: see packages/ui/CONTEXT.md). No Svelte runes, no toast, no socket
// — every message handler is a function over a plain BuilderState plus a small `deps` bag
// (the SchemaSource, an undo-history hook, a notifier, and a clone fn). The reactive shell
// in useBuilderState.svelte.ts is a thin delegation layer over these; everything testable
// lives here and runs in the node-env vitest through a FakeSource.

import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
import { getAllLayoutItems } from '$lib/features/builder/operations';
import { updateParameterMetadata } from '$lib/features/preview/handlers';
import { processInitialDataSchema } from '$lib/utils/schema-defaults';
import type { SchemaSource } from '$lib/schema-source/schema-source';
import type {
	SyncDiff,
	SyncChange,
	WsInitialDataMessage,
	WsOutputsMessage,
	WsSchemaUpdatedMessage,
	WsSchemaSaveRejectedMessage,
	WsMetadataUpdatedMessage,
	WsParametersAddedMessage,
	WsSyncPreviewMessage,
	WsSyncAppliedMessage
} from '$lib/websocket/websocket.svelte';

export interface BuilderState {
	availableInputs: DiscoveredInput[];
	availableOutputs: DiscoveredOutput[];
	/** Last schema received from the server. Read-only mirror; never edited directly by the UI. */
	canonical: UISchema | null;
	/** Hash of `canonical` as reported by the server. Echoed back on save for conflict detection. */
	canonicalHash: string | null;
	/** The schema the user is editing. Always a deep clone of `canonical` on load. */
	draft: UISchema | null;
	/** Flipped on the first mutation of `draft` in a session. Cleared on save / discard. */
	isDirty: boolean;
	/** documentId of the currently-loaded Grasshopper definition (carried on the schema). */
	documentId: string | null;
	loading: boolean;
	error: string;
	syncNeeded: boolean;
	activeTabId: string | null;
	syncDialogOpen: boolean;
	syncDiff: SyncDiff | null;
	syncLoading: boolean;
	outputValues: Record<string, unknown>;
}

/** Toast surface the core talks to; the shell wires it to @selvajs/ui's `toast`. */
export interface BuilderNotifier {
	info(message: string): void;
	success(message: string): void;
	warning(message: string): void;
	error(message: string): void;
}

/** Undo-history hook the core clears on canonical replacement. */
export interface BuilderHistory {
	clearHistory(): void;
}

/**
 * Everything the handlers reach for beyond the state itself. `clone` is injected because
 * production needs `$state.snapshot` (a rune) before structuredClone, while tests pass a
 * plain structuredClone — the core stays runes-free either way.
 */
export interface BuilderDeps {
	sessionId: string;
	source: SchemaSource;
	history: BuilderHistory;
	notify: BuilderNotifier;
	clone: (schema: UISchema) => UISchema;
}

export function createInitialBuilderState(): BuilderState {
	return {
		availableInputs: [],
		availableOutputs: [],
		canonical: null,
		canonicalHash: null,
		draft: null,
		isDirty: false,
		documentId: null,
		loading: true,
		error: '',
		syncNeeded: false,
		activeTabId: null,
		syncDialogOpen: false,
		syncDiff: null,
		syncLoading: false,
		outputValues: {}
	};
}

/** Patch dropdown layout item configs in the schema when options change at runtime. */
function patchDropdownOptions(
	schema: UISchema | null,
	paramId: string,
	options: { [k: string]: string | undefined }
): void {
	if (!schema) return;
	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input' || item.widgetType !== 'dropdown' || item.paramId !== paramId)
			continue;
		item.config = { ...item.config, options };
	}
}

/**
 * Replace `canonical` with a freshly-received schema. If `draft` is clean, re-clone it from
 * the new canonical so live changes show through. If `draft` is dirty, leave it alone — the
 * user's edits win until they save (and may be rejected) or discard. A toast warns about
 * the divergence.
 */
export function replaceCanonical(
	state: BuilderState,
	deps: BuilderDeps,
	schema: UISchema,
	hash: string | null,
	reason?: string
): void {
	state.canonical = schema;
	state.canonicalHash = hash;
	state.documentId = (schema?.documentId as string | undefined) ?? state.documentId;

	if (state.isDirty) {
		deps.notify.warning(reason ?? 'Grasshopper changed while you were editing.');
		return;
	}

	state.draft = deps.clone(schema);
	deps.history.clearHistory();
}

/** Mark the draft as dirty on the first mutation in a session. */
export function markDirty(state: BuilderState): void {
	if (!state.isDirty) state.isDirty = true;
}

/** Reset the draft to a fresh clone of canonical. Clears dirty. */
export function discardDraft(state: BuilderState, deps: BuilderDeps): void {
	if (!state.canonical) return;
	state.draft = deps.clone(state.canonical);
	state.isDirty = false;
	deps.history.clearHistory();
}

export function handleOutputs(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsOutputsMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	if (message.outputs) Object.assign(state.outputValues, message.outputs);
}

export function handleInitialData(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsInitialDataMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	if (message.outputs) Object.assign(state.outputValues, message.outputs);

	const result = processInitialDataSchema(message);

	state.availableInputs = result.availableInputs;
	state.availableOutputs = result.availableOutputs;

	// Canonical comes from the server, period. Drafts live only in memory for the lifetime
	// of this tab — see useSchemaHistory for why LS persistence was removed.
	const schema = result.schema;
	if (schema) {
		state.canonical = schema;
		state.canonicalHash = (message.schemaHash as string | undefined) ?? null;
		state.documentId = (schema.documentId as string | undefined) ?? null;

		if (!state.draft || !state.isDirty) {
			state.draft = deps.clone(schema);
			deps.history.clearHistory();
		}
	}

	if (state.availableInputs.length === 0 && state.availableOutputs.length === 0) {
		state.error =
			'No parameters or outputs found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.';
	}

	if (state.draft?.layout?.type === 'tabbed' && state.draft.layout.tabs.length > 0) {
		state.activeTabId = state.draft.layout.tabs[0].id;
	}

	state.loading = false;
}

export function handleMetadataUpdated(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsMetadataUpdatedMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	const changedParams = message.changedParams ?? [];
	if (changedParams.length === 0) return;

	// Patch canonical (the server-side mirror) so the next clean re-clone or save-base-hash
	// reflects the metadata. Also patch the draft live — even when dirty — so a Grasshopper-
	// side rename doesn't strand the user with a stale label or block them behind a conflict.
	const canonicalResult = state.canonical
		? updateParameterMetadata(state.canonical, changedParams)
		: { updated: 0, names: [] };

	if (state.draft) updateParameterMetadata(state.draft, changedParams);

	// Track names that weren't already captured by the schema helper so we don't double-toast.
	const additionalNames: string[] = [];

	changedParams.forEach((updated) => {
		const inSchema =
			(state.canonical?.inputs.some((inp) => inp.id === updated.id) ?? false) ||
			(state.canonical?.outputs.some((out) => out.id === updated.id) ?? false);

		const availIndex = state.availableInputs.findIndex((p) => p.id === updated.id);
		if (availIndex !== -1) {
			if (updated.nickname !== undefined)
				state.availableInputs[availIndex].nickname = updated.nickname;
			if (updated.description !== undefined)
				state.availableInputs[availIndex].description = updated.description;
			if (updated.minimum !== undefined)
				state.availableInputs[availIndex].minimum = updated.minimum;
			if (updated.maximum !== undefined)
				state.availableInputs[availIndex].maximum = updated.maximum;
			if (updated.stepSize !== undefined)
				state.availableInputs[availIndex].stepSize = updated.stepSize;
			if (updated.options !== undefined) {
				state.availableInputs[availIndex].options = updated.options;
				patchDropdownOptions(state.canonical, updated.id, updated.options);
				patchDropdownOptions(state.draft, updated.id, updated.options);
			}
			if (!inSchema && updated.nickname !== undefined) additionalNames.push(updated.nickname);
		}

		const availOutputIndex = state.availableOutputs.findIndex((o) => o.id === updated.id);
		if (availOutputIndex !== -1) {
			if (updated.nickname !== undefined)
				state.availableOutputs[availOutputIndex].nickname = updated.nickname;
			if (updated.description !== undefined)
				state.availableOutputs[availOutputIndex].description = updated.description;
			if (!inSchema && updated.nickname !== undefined) additionalNames.push(updated.nickname);
		}
	});

	// Patching canonical changes its content — its hash is now stale until the server
	// re-broadcasts. Clear the hash so a save attempt before the next schemaUpdated is rejected
	// (SchemaSaveGuard treats a missing base hash as unjudgeable) rather than racing.
	if (canonicalResult.updated > 0) {
		state.canonicalHash = null;
	}

	// Use canonical's name list only — draft is a sibling clone patched for live render, so
	// its `names` would duplicate canonical's.
	const updatedNames = [...canonicalResult.names, ...additionalNames];
	if (updatedNames.length > 0) {
		deps.notify.info(
			`Parameter${updatedNames.length > 1 ? 's' : ''} renamed in Grasshopper: ${updatedNames.join(', ')}`
		);
	}
}

export function handleSchemaUpdated(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsSchemaUpdatedMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	// Detect new IDs *before* replacing canonical so we know whether to refetch
	// availableInputs/Outputs. The plugin auto-merges newly-discovered params into
	// schema.inputs/outputs and broadcasts schemaUpdated (no separate parametersAdded), so
	// the sidebar would otherwise miss them.
	const knownInputIds = state.availableInputs.map((p) => p.id);
	const knownOutputIds = state.availableOutputs.map((o) => o.id);
	const hasNewInputs = (message.schema?.inputs ?? []).some((i) => !knownInputIds.includes(i.id));
	const hasNewOutputs = (message.schema?.outputs ?? []).some((o) => !knownOutputIds.includes(o.id));

	// schemaUpdated is the canonical broadcast — replace wholesale.
	if (message.schema) {
		replaceCanonical(state, deps, message.schema, message.schemaHash ?? null);
	}

	const removedIds = message.removedIds || [];
	if (removedIds.length > 0) {
		state.availableInputs = state.availableInputs.filter((p) => !removedIds.includes(p.id));
		state.availableOutputs = state.availableOutputs.filter((o) => !removedIds.includes(o.id));

		deps.notify.info(
			`${removedIds.length} item${removedIds.length > 1 ? 's' : ''} removed from Grasshopper`
		);
	}

	// If active tab no longer exists on the new draft, switch to first available.
	if (state.draft?.layout?.type === 'tabbed') {
		if (state.activeTabId && !state.draft.layout.tabs.find((t) => t.id === state.activeTabId)) {
			state.activeTabId = state.draft.layout.tabs.length > 0 ? state.draft.layout.tabs[0].id : null;
		}
	}

	// Newly-added params from the canvas: the schema arrived with IDs we have no
	// availableInputs/Outputs entry for. Refetch so the sidebar shows them.
	if (hasNewInputs || hasNewOutputs) {
		deps.source.requestInitialData(deps.sessionId);
	}
}

export function handleSchemaSaveRejected(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsSchemaSaveRejectedMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	// Server says our base hash is stale. Replace canonical with the server's current schema
	// so the next save attempt uses the fresh hash. The user keeps their dirty draft; the
	// toast tells them what happened.
	state.canonical = message.schema;
	state.canonicalHash = message.schemaHash ?? null;

	deps.notify.error(message.reason ?? 'Grasshopper changed since you started editing.');
}

export function handleParametersAdded(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsParametersAddedMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	const availableParams = message.availableParams;
	let updated = false;

	if (availableParams?.inputs && Array.isArray(availableParams.inputs)) {
		state.availableInputs = availableParams.inputs;
		updated = true;
	}

	if (availableParams?.outputs && Array.isArray(availableParams.outputs)) {
		state.availableOutputs = availableParams.outputs;
		updated = true;
	}

	if (updated) {
		state.syncNeeded = true;
		deps.notify.info('New items detected - click Sync to add them to your schema');
	} else {
		deps.source.requestInitialData(deps.sessionId);
		deps.notify.info('New items detected - refreshing...');
	}
}

export function syncParameters(state: BuilderState, deps: BuilderDeps): void {
	state.syncNeeded = false;
	deps.source.requestInitialData(deps.sessionId);
	deps.notify.info('Syncing parameters...');
}

export function handleSyncPreview(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsSyncPreviewMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	// C# sends fromGH/toGH as camelCase (anonymous object properties). Each SyncChange has
	// PascalCase properties (serialized from C# class).
	state.syncDiff = {
		fromGH: message.fromGH || [],
		toGH: message.toGH || []
	};
	state.syncLoading = false;
}

export function handleSyncApplied(
	state: BuilderState,
	deps: BuilderDeps,
	message: WsSyncAppliedMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	state.syncLoading = false;
	if (message.success) {
		deps.notify.success(message.message || 'Sync completed successfully');
		state.syncDialogOpen = false;
		state.syncDiff = null;
		deps.source.requestInitialData(deps.sessionId);
	} else {
		deps.notify.error(message.message || 'Sync failed');
	}
}

export function requestSyncPreview(state: BuilderState, deps: BuilderDeps): void {
	if (!state.draft) return;
	state.syncDiff = null;
	state.syncLoading = true;
	state.syncDialogOpen = true;
	deps.source.requestSyncPreview(deps.sessionId, deps.clone(state.draft));
}

export function applySyncChanges(
	state: BuilderState,
	deps: BuilderDeps,
	selectedChanges: SyncChange[]
): void {
	state.syncLoading = true;
	deps.source.applySyncChanges(deps.sessionId, selectedChanges);
}

/**
 * Persist the draft through the source and apply the post-save lifecycle transition.
 * Returns the SaveResult so the route can act on it. On success, clears dirty so the next
 * schemaUpdated broadcast re-clones the draft cleanly; on failure the dirty draft is kept.
 */
export async function saveDraft(state: BuilderState, deps: BuilderDeps): Promise<boolean> {
	if (!state.draft) {
		deps.notify.error('Schema not initialized');
		return false;
	}
	if (!deps.sessionId) {
		deps.notify.error('Session not initialized');
		return false;
	}
	if (!deps.source.connected) {
		deps.notify.error('Not connected to Grasshopper');
		return false;
	}

	const result = await deps.source.save(
		deps.sessionId,
		deps.clone(state.draft),
		state.canonicalHash
	);

	if (result.ok) {
		// The schemaUpdated broadcast that precedes the ack carries the just-saved state.
		// Clearing isDirty lets replaceCanonical re-clone the draft cleanly on that broadcast.
		state.isDirty = false;
		deps.notify.success('Schema saved successfully');
		return true;
	}

	deps.notify.error(`Failed to save schema: ${result.reason}`);
	return false;
}
