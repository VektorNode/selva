/**
 * WebSocket client for real-time communication with Grasshopper (local mode only)
 * Uses Svelte 5 runes for reactive state management
 */

import {
	WEBSOCKET_MAX_RECONNECT_ATTEMPTS,
	WEBSOCKET_RECONNECT_INTERVAL,
	DEFAULT_WEBSOCKET_PORT
} from '$lib/app.config';
import type { UISchema } from '@selvajs/ui';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

export type MessageHandler = (data: unknown) => void;

/**
 * Represents a single metadata difference between Grasshopper and schema
 * Note: property names match JSON.NET PascalCase serialization of C# classes
 */
export interface SyncChange {
	ParamId: string;
	ParamNickname: string;
	Field: 'nickname' | 'description';
	SchemaValue: unknown;
	GHValue: unknown;
	Direction: 'fromGH' | 'toGH';
}

/**
 * Complete sync diff showing what would change in each direction
 * Note: fromGH/toGH are camelCase because C# sends them as an anonymous object
 */
export interface SyncDiff {
	fromGH: SyncChange[];
	toGH: SyncChange[];
}

/**
 * WebSocket state class with reactive properties
 */
export class WebSocketState {
	private socket: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private messageHandlers: Map<string, Set<MessageHandler>> = new SvelteMap();
	private reconnectAttempts = 0;
	private maxReconnectAttempts = WEBSOCKET_MAX_RECONNECT_ATTEMPTS;
	private reconnectDelay = WEBSOCKET_RECONNECT_INTERVAL;
	private isConnecting = false;
	private _pendingValueUpdate: { sessionId: string; values: Record<string, unknown> } | null = null;
	private _serverDisconnected = false;
	private _shouldReloadOnReconnect = false;
	private solvingTimeout: ReturnType<typeof setTimeout> | null = null;
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private batchedValues: Record<string, unknown> = {};
	private currentSessionId: string | null = null;
	private readonly BATCH_DELAY_MS = 50; // Batch updates within 50ms window

	// Reactive state using Svelte 5 runes
	connected = $state(false);
	isSolving = $state(false);

	constructor(private url: string) {
		this.on('solvingState', (data) => {
			if (data && typeof data === 'object' && 'isSolving' in data) {
				const newState = Boolean(data.isSolving);

				// Only log and process if state actually changed
				if (newState !== this.isSolving) {
					// console.info(
					// 	`[WebSocket] Grasshopper solving state: ${newState} (was: ${this.isSolving})`
					// );
					this.isSolving = newState;

					// Clear any pending timeout when we get an explicit solving state update
					if (this.solvingTimeout) {
						clearTimeout(this.solvingTimeout);
						this.solvingTimeout = null;
					}

					// If solving just finished, handle pending/batched updates
					if (!this.isSolving) {
						// First, flush any batched updates
						if (this.batchTimer) {
							clearTimeout(this.batchTimer);
							this.batchTimer = null;
							this.flushBatchedUpdates();
						}

						// Then send any pending update from while solving
						if (this._pendingValueUpdate) {
							this.send('valueUpdate', this._pendingValueUpdate);
							this._pendingValueUpdate = null;
						}
					}
				}
			}
		});

		// Handle runtime messages from Grasshopper (errors, warnings, info)
		this.on('runtimeMessage', (data) => {
			if (data && typeof data === 'object' && 'level' in data && 'message' in data) {
				const msg = data as { level: string; message: string; timestamp?: string };

				// Dispatch custom event for toast notifications
				if (typeof window !== 'undefined') {
					window.dispatchEvent(
						new CustomEvent('grasshopper-runtime-message', {
							detail: msg
						})
					);
				}
			}
		});
	}

	/**
	 * Connect to the WebSocket server
	 */
	connect(): Promise<boolean> {
		if (this.socket?.readyState === WebSocket.OPEN || this.isConnecting) {
			return Promise.resolve(true);
		}

		this.isConnecting = true;

		return new Promise((resolve) => {
			try {
				this.socket = new WebSocket(this.url);

				this.socket.onopen = () => {
					// If reconnecting after server disconnect, reload the page to get fresh state
					if (this._shouldReloadOnReconnect) {
						window.location.reload();
						return;
					}

					this.reconnectAttempts = 0;
					this._serverDisconnected = false;
					this.isConnecting = false;
					this.connected = true;
					resolve(true);
				};

				this.socket.onmessage = (event) => {
					try {
						if (!event.data || typeof event.data !== 'string' || event.data.trim() === '') {
							return;
						}

						const message = JSON.parse(event.data);
						this.handleMessage(message);
					} catch (error) {
						console.error('[WebSocket] Failed to parse message:', error);
					}
				};

				this.socket.onerror = (error) => {
					console.error('[WebSocket] Error:', error);
					this.isConnecting = false;
					resolve(false);
				};

				this.socket.onclose = () => {
					this.isConnecting = false;
					this.socket = null;
					this.connected = false;
					this.attemptReconnect();
				};
			} catch (error) {
				console.error('[WebSocket] Connection failed:', error);
				this.isConnecting = false;
				resolve(false);
			}
		});
	}

	/**
	 * Disconnect from the WebSocket server
	 */
	disconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		if (this.solvingTimeout) {
			clearTimeout(this.solvingTimeout);
			this.solvingTimeout = null;
		}

		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}

		this.reconnectAttempts = 0;
		this.connected = false;
		this.batchedValues = {};
		this._pendingValueUpdate = null;
	}

	/**
	 * Send a message to the server
	 */
	send(type: string, data: Record<string, unknown>) {
		if (this.socket?.readyState === WebSocket.OPEN) {
			const message = { type, ...data };
			const jsonStr = JSON.stringify(message);

			try {
				this.socket.send(jsonStr);
			} catch (error) {
				console.error(`[WebSocket] Failed to send message:`, error);
			}
		} else {
			console.warn('[WebSocket] Cannot send message - not connected');
		}
	}

	/**
	 * Send value updates to Grasshopper with batching
	 * Multiple rapid updates are batched within a short time window to reduce network traffic
	 * If Grasshopper is currently solving, the update will be queued and sent when solving completes
	 */
	sendValueUpdate(sessionId: string, values: Record<string, unknown>) {
		if (this.isSolving) {
			// Queue the update - only keep the latest one
			this._pendingValueUpdate = { sessionId, values };
			return;
		}

		// Batch updates within the time window
		this.currentSessionId = sessionId;
		Object.assign(this.batchedValues, values);

		// Clear existing timer and set new one
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
		}

		this.batchTimer = setTimeout(() => {
			this.flushBatchedUpdates();
		}, this.BATCH_DELAY_MS);
	}

	/**
	 * Immediately send all batched value updates
	 */
	private flushBatchedUpdates() {
		if (Object.keys(this.batchedValues).length === 0 || !this.currentSessionId) {
			return;
		}

		const sessionId = this.currentSessionId;
		const values = { ...this.batchedValues };

		// Clear batch state
		this.batchedValues = {};
		this.batchTimer = null;

		// console.log(
		// 	`[WebSocket] Sending batched value update with ${Object.keys(values).length} values`
		// );
		this.send('valueUpdate', { sessionId, values });

		// Set a single timeout to auto-clear solving state if no update received from server
		// This prevents the UI from getting stuck in "Solving..." state if messages are lost
		if (this.solvingTimeout) {
			clearTimeout(this.solvingTimeout);
		}
		this.solvingTimeout = setTimeout(() => {
			if (this.isSolving) {
				console.warn('[WebSocket] Solving state timeout - clearing stuck solving indicator');
				this.isSolving = false;
			}
			this.solvingTimeout = null;
		}, 30000); // 30 second timeout
	}

	/**
	 * Request current values from Grasshopper
	 */
	requestCurrentValues(sessionId: string) {
		// console.log('[WebSocket] Requesting current values from Grasshopper');
		this.send('requestCurrentValues', { sessionId });
	}

	/**
	 * Request initial data (schema, available params, current values) from Grasshopper
	 */
	requestInitialData(sessionId: string) {
		// console.log('[WebSocket] Requesting initial data from Grasshopper');
		this.send('requestInitialData', { sessionId });
	}

	/**
	 * Save schema to Grasshopper
	 */
	saveSchema(sessionId: string, schema: UISchema) {
		this.send('saveSchema', { sessionId, schema });
	}

	/**
	 * Request sync preview (diff between Grasshopper and schema state)
	 */
	requestSyncPreview(sessionId: string, schema: UISchema) {
		this.send('requestSyncPreview', { sessionId, schema });
	}

	/**
	 * Apply selected sync changes to Grasshopper
	 */
	applySyncChanges(sessionId: string, changes: SyncChange[]) {
		this.send('applySyncChanges', { sessionId, changes });
	}

	/**
	 * Register a handler for a specific message type
	 */
	on(messageType: string, handler: MessageHandler) {
		if (!this.messageHandlers.has(messageType)) {
			this.messageHandlers.set(messageType, new SvelteSet());
		}
		this.messageHandlers.get(messageType)!.add(handler);
	}

	/**
	 * Unregister a handler
	 */
	off(messageType: string, handler: MessageHandler) {
		this.messageHandlers.get(messageType)?.delete(handler);
	}

	/**
	 * Check if connected
	 */
	get isConnected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	/**
	 * Handle incoming messages
	 */
	private handleMessage(message: unknown) {
		if (message && typeof message === 'object' && 'type' in message) {
			const msg = message as { type: string; data?: unknown };
			if (msg.type === 'disconnecting') {
				console.warn(
					'[WebSocket] Server is disconnecting:',
					(msg.data as { reason?: string } | undefined)?.reason || 'No reason provided'
				);

				// console.log(message);
				// Mark as server-initiated disconnect - will reload page on reconnect
				this._serverDisconnected = true;
				this._shouldReloadOnReconnect = true;
				return;
			}

			const handlers = this.messageHandlers.get(msg.type);
			if (handlers) {
				handlers.forEach((handler) => handler(msg));
			}
		}
	}

	/**
	 * Attempt to reconnect
	 * - If server disconnected: use fixed 5-second interval indefinitely
	 * - Otherwise: use exponential backoff with max attempts
	 */
	private attemptReconnect() {
		// If server disconnected, keep trying with fixed interval (no max attempts)
		if (this._serverDisconnected) {
			const fixedDelay = 5000; // 5 seconds
			// console.log(`[WebSocket] Server disconnected, retrying in ${fixedDelay}ms`);

			this.reconnectTimer = setTimeout(() => {
				this.connect();
			}, fixedDelay);
			return;
		}

		// Otherwise, use exponential backoff with max attempts
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			// console.log('[WebSocket] Max reconnection attempts reached');
			return;
		}

		this.reconnectAttempts++;
		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

		// console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, delay);
	}
}

// Singleton instances (one per port for multi-instance support)
const wsStateByPort: Map<number, WebSocketState> = new SvelteMap();

/**
 * Get or create the WebSocket state instance (singleton per port)
 * Constructs WebSocket URL dynamically from query parameters or uses default port
 * Supports multiple instances by caching WebSocket connections per port
 */
export function getWebSocketState(port?: number): WebSocketState {
	const wsPort = port ?? DEFAULT_WEBSOCKET_PORT;

	// Check if we already have a connection for this port
	if (wsStateByPort.has(wsPort)) {
		return wsStateByPort.get(wsPort)!;
	}

	// Create new WebSocket connection for this port
	const url = `ws://localhost:${wsPort}`;
	// console.log(`[WebSocket] Initializing new connection with URL: ${url}`);
	const newWsState = new WebSocketState(url);
	wsStateByPort.set(wsPort, newWsState);

	return newWsState;
}
