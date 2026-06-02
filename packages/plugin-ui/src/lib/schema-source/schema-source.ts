// SchemaSource: the single transport seam between the builder/preview state machines and
// Grasshopper. The state machines subscribe to push events and issue commands; they never
// learn whether the bytes come from a Grasshopper WebSocket or a test fake. This interface
// IS the Grasshopper boundary for the webapp — to retarget at a different backend, write
// one more adapter and nothing in the composables/routes changes.
//
// Two adapters define the seam: GrasshopperSource (wraps getWebSocketState, also vends the
// preview SolveDriver) and FakeSource (replays canned events, records sends — lives in test
// code). One adapter would be a hypothetical seam; the second is what proves it.

import type { SolveDriver, SolveReporter } from '@selvajs/ui';
import type {
	WsInitialDataMessage,
	WsOutputsMessage,
	WsSchemaUpdatedMessage,
	WsSchemaSaveRejectedMessage,
	WsMetadataUpdatedMessage,
	WsParametersAddedMessage,
	WsCurrentValuesMessage,
	WsSyncPreviewMessage,
	WsSyncAppliedMessage,
	SyncChange
} from '$lib/websocket/websocket.svelte';
import type { UISchema } from '@selvajs/schemas';

/**
 * The push events the builder/preview state subscribes to. Each entry maps an event name to
 * the message payload its handler receives. Mirrors the C# WebSocket protocol, but the
 * state machines only depend on this map — not on the socket.
 *
 * Note: `outputs` and binary mesh frames are NOT here. Those feed the solve loop and are
 * consumed inside the SolveDriver (makeSolveDriver), which reports results back through the
 * Solve Session rather than the schema-push bus.
 */
export interface SchemaSourceEvents {
	initialData: WsInitialDataMessage;
	metadataUpdated: WsMetadataUpdatedMessage;
	schemaUpdated: WsSchemaUpdatedMessage;
	schemaSaveRejected: WsSchemaSaveRejectedMessage;
	parametersAdded: WsParametersAddedMessage;
	currentValues: WsCurrentValuesMessage;
	syncPreview: WsSyncPreviewMessage;
	syncApplied: WsSyncAppliedMessage;
	/** Builder-only: live output values for the layout editor's read-only previews. */
	outputs: WsOutputsMessage;
	/** Preview-only: output-only push (no display payload) outside the solve report path. */
	outputUpdate: WsOutputsMessage;
}

export type SchemaSourceEvent = keyof SchemaSourceEvents;

export type SchemaSourceHandler<E extends SchemaSourceEvent> = (
	message: SchemaSourceEvents[E]
) => void;

/** Outcome of a save: the server either accepted the draft or rejected it (stale base). */
export type SaveResult = { ok: true } | { ok: false; reason: string };

/** Outcome of establishing the transport for a session. */
export type ConnectResult = { ok: true } | { ok: false; error: string };

/**
 * Everything the builder/preview state needs from its transport. Subscribe to push events
 * with on/off; pull data, push saves/sync/values with the command methods; obtain a
 * transport-bound SolveDriver for the preview's Solve Session via makeSolveDriver().
 * `connected` reflects whether the transport can currently carry commands (the fake is
 * always connected).
 */
export interface SchemaSource {
	readonly connected: boolean;

	on<E extends SchemaSourceEvent>(event: E, handler: SchemaSourceHandler<E>): void;
	off<E extends SchemaSourceEvent>(event: E, handler: SchemaSourceHandler<E>): void;

	/**
	 * Establish the transport for this session. Resolves once it's ready to carry commands, or
	 * with an error message if it couldn't connect. The fake is always ready.
	 */
	connect(sessionId: string): Promise<ConnectResult>;

	/** Ask the source to (re)emit `initialData` for this session. */
	requestInitialData(sessionId: string): void;

	/**
	 * Persist a draft. Resolves once the source acknowledges (ack) or rejects (stale base /
	 * error). Encapsulates the request/response + timeout so callers just await. On reject,
	 * the source has already emitted `schemaSaveRejected` for the state machine to react to.
	 */
	save(sessionId: string, draft: UISchema, baseHash: string | null): Promise<SaveResult>;

	requestSyncPreview(sessionId: string, draft: UISchema): void;
	applySyncChanges(sessionId: string, changes: SyncChange[]): void;

	/**
	 * Build a SolveDriver (see @selvajs/ui) bound to this transport for the given session.
	 * The driver sends values on solve() and, as outputs + binary mesh frames arrive, reports
	 * them back through the reporter. All WebSocket solve quirks — value preparation, the
	 * monotonic-token mesh-blob streaming, the in-flight `isSolving` mirror — stay inside the
	 * adapter; the Solve Session never learns them.
	 */
	makeSolveDriver(sessionId: string, getReporter: () => SolveReporter): PreviewSolveDriver;
}

/**
 * A SolveDriver plus the lifecycle hooks the preview needs from a push transport: a way to
 * tear down its event subscriptions, and the "seed the first solve once data is ready"
 * trigger that the WS flow performs after initialData.
 */
export interface PreviewSolveDriver extends SolveDriver {
	/**
	 * Ingest the outputs/meshes carried *on the initialData frame itself* (the server includes
	 * the last solve's result so the preview can paint immediately, before any fresh solve).
	 * Runs the same parse-and-report path as a live outputs frame. The message is the raw
	 * initialData payload (which is shaped like an outputs envelope for these fields).
	 */
	primeFromInitialData(message: WsOutputsMessage): void;
	/** Detach the driver's transport subscriptions (outputs/binary frames). */
	dispose(): void;
}
