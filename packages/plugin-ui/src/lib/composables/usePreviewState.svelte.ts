// Reactive shell over preview-state-core.ts + a Solve Session (see @selvajs/ui CONTEXT.md).
// It owns the $state for schema/loading/error/sync, constructs a SchemaSource and — once the
// first schema arrives — a SolveSession driven by that source's WebSocket SolveDriver. The
// session owns values/meshes/solve-gating; this shell owns schema/notifications and routes
// push events to the pure core. All transport quirks live in the GrasshopperSource adapter.

import type { SupportedTypes } from '@selvajs/schemas';
import type { WsOutputsMessage } from '$lib/websocket/websocket.svelte';
import { createSolveSession, type SolveSession, type SolveReporter } from '@selvajs/ui';
import { getWebSocketPortFromUrl } from '$lib/utils/session';
import { getGrasshopperSource } from '$lib/schema-source/grasshopper-source';
import type { SchemaSource, PreviewSolveDriver } from '$lib/schema-source/schema-source';
import { createNotificationManager } from '$lib/features/preview/notifications.svelte';
import {
	createInitialPreviewState,
	handleInitialData as coreHandleInitialData,
	handleCurrentValues as coreHandleCurrentValues,
	handleOutputUpdate as coreHandleOutputUpdate,
	handleSchemaUpdated as coreHandleSchemaUpdated,
	handleMetadataUpdated as coreHandleMetadataUpdated,
	handleParametersAdded as coreHandleParametersAdded,
	clearSyncNeeded,
	type PreviewState,
	type PreviewDeps
} from './preview-state-core';

const EMPTY_VALUES: Record<string, unknown> = {};
const EMPTY_MESHES: unknown[] = [];

/**
 * @param source Defaults to the Grasshopper WebSocket source bound to the URL's wsPort.
 *   Tests inject a FakeSource to exercise the state machine without a live socket.
 */
export function usePreviewState(getSessionId: () => string, source?: SchemaSource) {
	const schemaSource = source ?? getGrasshopperSource(getWebSocketPortFromUrl());
	const state = $state<PreviewState>(createInitialPreviewState());
	const { manager: notification, getMessage: getNotification } = createNotificationManager();

	// The Solve Session and its driver are built on the first initialData (once a schema and
	// scope key exist). Until then the route is in `loading` and never reads values/meshes.
	let session: SolveSession | null = null;
	let driver: PreviewSolveDriver | null = null;
	let initialized = false;

	const reporter: SolveReporter = {
		report: (result) => session?.report(result),
		reportError: (message) => {
			if (session) session.reportError(message);
			else state.error = message;
		}
	};

	// Lazily builds the Solve Session + driver the first time the core reaches for it (which is
	// from inside handleInitialData's loadValues, once state.schema is set). Before that the
	// route is in `loading` and never reads values/meshes, so a build-on-demand getter keeps
	// the pure handlers total without a no-op stand-in.
	function getOrBuildSession(): SolveSession {
		if (!session) {
			const schema = state.schema!; // set by the core before it touches the session
			driver = schemaSource.makeSolveDriver(getSessionId(), () => reporter);
			session = createSolveSession({ schema, scopeKey: getSessionId(), driver });
		}
		return session;
	}

	/** Build deps with the live sessionId for a handler invocation. */
	function depsFor(): PreviewDeps {
		return {
			sessionId: getSessionId(),
			get session() {
				return getOrBuildSession();
			},
			notify: notification
		};
	}

	// Bound push-event handlers (stable refs for on/off).
	const onInitialData = (m: Parameters<typeof coreHandleInitialData>[2]) => {
		coreHandleInitialData(state, depsFor(), m);
		// initialData carries the last solve's outputs/meshes so the preview paints immediately.
		// The core seeded values + built the session via loadValues; now feed those outputs
		// through the driver's parse+report path (it owns mesh-frame collection).
		if (state.schema && m.outputs && Object.keys(m.outputs).length > 0) {
			driver?.primeFromInitialData(m as WsOutputsMessage);
		}
	};
	const onCurrentValues = (m: Parameters<typeof coreHandleCurrentValues>[2]) =>
		coreHandleCurrentValues(state, depsFor(), m);
	const onOutputUpdate = (m: Parameters<typeof coreHandleOutputUpdate>[2]) =>
		coreHandleOutputUpdate(state, depsFor(), m);
	const onSchemaUpdated = (m: Parameters<typeof coreHandleSchemaUpdated>[2]) =>
		coreHandleSchemaUpdated(state, depsFor(), m);
	const onMetadataUpdated = (m: Parameters<typeof coreHandleMetadataUpdated>[2]) =>
		coreHandleMetadataUpdated(state, depsFor(), m);
	const onParametersAdded = (m: Parameters<typeof coreHandleParametersAdded>[2]) =>
		coreHandleParametersAdded(state, depsFor(), m);

	function handleValueChange(paramId: string, value: SupportedTypes, forceSolve?: boolean) {
		session?.setValue(paramId, value, forceSolve);
	}

	function handleCalculate() {
		session?.solve();
	}

	/**
	 * Preset/external values were applied to the live values map by the host; re-run the solve
	 * (auto mode) or mark pending (manual). loadValues({}) merges nothing new but applies the
	 * instanceSolve gating — same outcome as the old "send current values or set pending".
	 */
	function handleLoadValues() {
		session?.loadValues({});
	}

	function syncParameters() {
		clearSyncNeeded(state);
		schemaSource.requestInitialData(getSessionId());
		notification.show('Syncing parameters...');
	}

	async function initialize() {
		const sessionId = getSessionId();
		if (!sessionId) return;
		if (initialized) return;
		initialized = true;

		schemaSource.on('initialData', onInitialData);
		schemaSource.on('currentValues', onCurrentValues);
		schemaSource.on('outputUpdate', onOutputUpdate);
		schemaSource.on('schemaUpdated', onSchemaUpdated);
		schemaSource.on('metadataUpdated', onMetadataUpdated);
		schemaSource.on('parametersAdded', onParametersAdded);

		const result = await schemaSource.connect(sessionId);
		if (!result.ok) {
			state.error = result.error;
			state.loading = false;
			return;
		}

		schemaSource.requestInitialData(sessionId);
	}

	function cleanup() {
		if (!initialized) return;
		initialized = false;

		notification.clear();
		schemaSource.off('initialData', onInitialData);
		schemaSource.off('currentValues', onCurrentValues);
		schemaSource.off('outputUpdate', onOutputUpdate);
		schemaSource.off('schemaUpdated', onSchemaUpdated);
		schemaSource.off('metadataUpdated', onMetadataUpdated);
		schemaSource.off('parametersAdded', onParametersAdded);
		driver?.dispose();
		driver = null;
		session = null;
	}

	return {
		get state() {
			return state;
		},
		/** Values map (inputs + reported outputs). Empty until the session is built. */
		get values() {
			return session?.values ?? EMPTY_VALUES;
		},
		/** Display meshes from the latest solve. Empty until the session is built. */
		get displayMeshes() {
			return session?.meshes ?? EMPTY_MESHES;
		},
		get isSolving() {
			return driver?.isSolving ?? false;
		},
		get hasPendingChanges() {
			return session?.hasPendingChanges ?? false;
		},
		get connected() {
			return schemaSource.connected;
		},
		get notification() {
			return getNotification();
		},
		handleValueChange,
		handleCalculate,
		handleLoadValues,
		syncParameters,
		initialize,
		cleanup
	};
}
