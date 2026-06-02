// FakeSource: the second adapter that proves the SchemaSource seam. Replays canned push
// events, records saves and sync calls, and lets a test resolve/reject pending saves
// deterministically. No socket, no Grasshopper — usable in the node-env vitest because it
// touches no Svelte runes.
//
// This is not throwaway scaffolding: it's the in-test counterpart to GrasshopperSource,
// and removing the WS wiring from useBuilderState makes that wiring reappear in exactly
// one place (GrasshopperSource), with the fake standing in everywhere else.

import type { UISchema } from '@selvajs/schemas';
import type { SolveReporter } from '@selvajs/ui';
import type {
	SchemaSource,
	SchemaSourceEvent,
	SchemaSourceEvents,
	SchemaSourceHandler,
	SaveResult,
	ConnectResult,
	PreviewSolveDriver
} from './schema-source';
import type { SyncChange } from '$lib/websocket/websocket.svelte';

/** A SolveDriver stand-in that records solves and exposes its reporter for the test to use. */
export interface FakeSolveDriver extends PreviewSolveDriver {
	/** Values passed to each solve(), in order. */
	readonly solves: Record<string, unknown>[];
	/** Number of cancel() calls. */
	readonly cancelCount: number;
	/** Whether dispose() has been called. */
	readonly disposed: boolean;
	/** Flip the reported in-flight state. */
	setSolving(value: boolean): void;
	/** The reporter the source handed the session — the test reports results through it. */
	readonly reporter: SolveReporter;
}

export interface RecordedSave {
	sessionId: string;
	draft: UISchema;
	baseHash: string | null;
	resolve: (result: SaveResult) => void;
}

export interface FakeSource extends SchemaSource {
	/** Emit a push event to all subscribed handlers (simulates a server broadcast). */
	emit<E extends SchemaSourceEvent>(event: E, message: SchemaSourceEvents[E]): void;
	/** Saves issued via save(), in order. The last entry's `resolve` settles its promise. */
	readonly saves: RecordedSave[];
	/** sessionIds passed to requestInitialData(), in order. */
	readonly initialDataRequests: string[];
	/** Sync-preview requests, in order. */
	readonly syncPreviewRequests: { sessionId: string; draft: UISchema }[];
	/** applySyncChanges calls, in order. */
	readonly appliedSyncChanges: { sessionId: string; changes: SyncChange[] }[];
	/** Flip connection state to exercise the disconnected path. */
	setConnected(value: boolean): void;
	/** The driver handed out by the last makeSolveDriver() call (null if never called). */
	readonly solveDriver: FakeSolveDriver | null;
}

export function createFakeSource(): FakeSource {
	const handlers = new Map<SchemaSourceEvent, Set<(message: unknown) => void>>();
	const saves: RecordedSave[] = [];
	const initialDataRequests: string[] = [];
	const syncPreviewRequests: { sessionId: string; draft: UISchema }[] = [];
	const appliedSyncChanges: { sessionId: string; changes: SyncChange[] }[] = [];
	let connected = true;
	let solveDriver: FakeSolveDriver | null = null;

	function buildSolveDriver(getReporter: () => SolveReporter): FakeSolveDriver {
		const solves: Record<string, unknown>[] = [];
		let cancelCount = 0;
		let disposed = false;
		let solving = false;
		// Resolve the reporter eagerly: the session is constructed with the driver in hand, so
		// by the time makeSolveDriver returns the lazy getReporter() is safe to call.
		const reporter = getReporter();

		return {
			solves,
			get cancelCount() {
				return cancelCount;
			},
			get disposed() {
				return disposed;
			},
			reporter,
			setSolving(value: boolean) {
				solving = value;
			},
			solve(values) {
				solves.push(values);
			},
			cancel() {
				cancelCount++;
			},
			get isSolving() {
				return solving;
			},
			primeFromInitialData() {
				// No transport to parse in the fake; tests drive results through reporter directly.
			},
			dispose() {
				disposed = true;
			}
		};
	}

	return {
		get connected() {
			return connected;
		},
		setConnected(value: boolean) {
			connected = value;
		},
		get solveDriver() {
			return solveDriver;
		},

		on<E extends SchemaSourceEvent>(event: E, handler: SchemaSourceHandler<E>) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)!.add(handler as (message: unknown) => void);
		},
		off<E extends SchemaSourceEvent>(event: E, handler: SchemaSourceHandler<E>) {
			handlers.get(event)?.delete(handler as (message: unknown) => void);
		},
		emit<E extends SchemaSourceEvent>(event: E, message: SchemaSourceEvents[E]) {
			handlers.get(event)?.forEach((handler) => handler(message));
		},

		async connect(_sessionId: string): Promise<ConnectResult> {
			return connected ? { ok: true } : { ok: false, error: 'Fake source not connected' };
		},

		requestInitialData(sessionId: string) {
			initialDataRequests.push(sessionId);
		},

		save(sessionId: string, draft: UISchema, baseHash: string | null): Promise<SaveResult> {
			return new Promise<SaveResult>((resolve) => {
				saves.push({ sessionId, draft, baseHash, resolve });
			});
		},

		requestSyncPreview(sessionId: string, draft: UISchema) {
			syncPreviewRequests.push({ sessionId, draft });
		},
		applySyncChanges(sessionId: string, changes: SyncChange[]) {
			appliedSyncChanges.push({ sessionId, changes });
		},

		makeSolveDriver(_sessionId: string, getReporter: () => SolveReporter) {
			solveDriver = buildSolveDriver(getReporter);
			return solveDriver;
		},

		saves,
		initialDataRequests,
		syncPreviewRequests,
		appliedSyncChanges
	};
}
