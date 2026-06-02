// Pure, framework-free transition logic for the preview's schema/notification state
// (mirrors builder-state-core.ts and the Solve Session split in @selvajs/ui). No runes, no
// socket. The VALUES + SOLVE LOOP do NOT live here — those belong to a SolveSession
// (createSolveSession) driven by the SchemaSource's WebSocket SolveDriver. This core owns
// only what's left: the schema, loading/error flags, sync-needed flag, model units, and the
// push-event handlers that feed schema/values changes into the session.
//
// The previous usePreviewState carried an `isRemoteUpdate` echo-guard and a 500ms initial-
// solve seed timeout. Both dissolve under the session: reported outputs land via
// session.report() (which never re-dispatches a solve), and session.loadValues() handles the
// initial dispatch per instanceSolve.

import type { UISchema } from '@selvajs/schemas';
import { ensureSchemaLayoutDefaults } from '$lib/utils/schema-defaults';
import {
	initializeValues,
	processOutputUpdate,
	updateParameterMetadata
} from '$lib/features/preview/handlers';
import {
	formatParameterUpdateMessage,
	formatMetadataUpdateMessage
} from '$lib/features/preview/notifications.svelte';
import type {
	WsInitialDataMessage,
	WsOutputsMessage,
	WsSchemaUpdatedMessage,
	WsMetadataUpdatedMessage,
	WsCurrentValuesMessage,
	WsSessionMessage
} from '$lib/websocket/websocket.svelte';

export interface PreviewState {
	schema: UISchema | null;
	loading: boolean;
	error: string;
	syncNeeded: boolean;
}

/** Notification surface (the rune-backed manager in production; a recorder in tests). */
export interface PreviewNotifier {
	show(message: string): void;
}

/**
 * The slice of a SolveSession the preview core drives. Outputs flow back through the driver's
 * report(), not these — these are the value-IN paths (initial seed, remote current-values
 * sync, schema-change pruning) plus the active-definition reset.
 */
export interface PreviewSession {
	readonly values: Record<string, unknown>;
	loadValues(incoming: Record<string, unknown>): void;
	rebuild(schema: UISchema, scopeKey: string): void;
}

export interface PreviewDeps {
	sessionId: string;
	session: PreviewSession;
	notify: PreviewNotifier;
}

export function createInitialPreviewState(): PreviewState {
	return { schema: null, loading: true, error: '', syncNeeded: false };
}

/**
 * Process the first data frame: normalise the schema, seed initial values, and hand them to
 * the session (which dispatches the initial solve per instanceSolve). Returns nothing; the
 * session owns values and the solve from here.
 */
export function handleInitialData(
	state: PreviewState,
	deps: PreviewDeps,
	message: WsInitialDataMessage
): void {
	if (message.sessionId !== deps.sessionId) return;

	if (!message.schema) {
		state.error = 'No schema configured. Please use the Schema Builder to create a UI.';
		state.loading = false;
		return;
	}

	const processedSchema = ensureSchemaLayoutDefaults(message.schema);
	if (!processedSchema) {
		state.error = 'Failed to process schema.';
		state.loading = false;
		return;
	}

	const initialValues = initializeValues({
		schema: processedSchema,
		availableParams: message.availableParams,
		currentValues: message.currentValues
	});

	state.schema = processedSchema;
	state.loading = false;

	// loadValues merges + dispatches the initial solve (auto mode) or marks pending (manual).
	// Outputs/meshes return asynchronously via the driver's report().
	deps.session.loadValues(initialValues);
}

/** Remote authoritative values (e.g. GH-side edits): merge into the session without solving. */
export function handleCurrentValues(
	_state: PreviewState,
	deps: PreviewDeps,
	message: WsCurrentValuesMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	Object.assign(deps.session.values, message.values);
}

/** Output-only push (no display payload). Filter to schema outputs and merge into values. */
export function handleOutputUpdate(
	state: PreviewState,
	deps: PreviewDeps,
	message: WsOutputsMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	const updates = processOutputUpdate({ outputs: message.outputs, schema: state.schema });
	if (Object.keys(updates).length > 0) Object.assign(deps.session.values, updates);
}

export function handleSchemaUpdated(
	state: PreviewState,
	deps: PreviewDeps,
	message: WsSchemaUpdatedMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	const removedCount = message.removedIds?.length || 0;
	if (removedCount > 0) {
		// Prune removed params from the session's live values in place.
		message.removedIds!.forEach((id) => delete deps.session.values[id]);
	}
	state.schema = ensureSchemaLayoutDefaults(message.schema);
	if (removedCount > 0) deps.notify.show(formatParameterUpdateMessage(removedCount));
}

export function handleMetadataUpdated(
	state: PreviewState,
	deps: PreviewDeps,
	message: WsMetadataUpdatedMessage
): void {
	if (message.sessionId !== deps.sessionId || !state.schema) return;
	const changedParams = message.changedParams ?? [];
	if (changedParams.length === 0) return;
	const result = updateParameterMetadata(state.schema, changedParams);
	if (result.updated > 0) deps.notify.show(formatMetadataUpdateMessage(result.names));
}

export function handleParametersAdded(
	state: PreviewState,
	deps: PreviewDeps,
	message: WsSessionMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	state.syncNeeded = true;
	deps.notify.show('New parameters detected - click Sync to add them to your UI');
}

/** User asked to sync: clear the flag and ask the source to re-send initial data. */
export function clearSyncNeeded(state: PreviewState): void {
	state.syncNeeded = false;
}
