/**
 * WebSocket client for real-time communication with Grasshopper (local mode only)
 * Uses Svelte 5 runes for reactive state management
 */

import type { UISchema } from '$lib/types/generated';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

export type MessageHandler = (data: unknown) => void;

/**
 * WebSocket state class with reactive properties
 */
export class WebSocketState {
	private socket: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private messageHandlers: Map<string, Set<MessageHandler>> = new SvelteMap();
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectDelay = 1000;
	private isConnecting = false;
	private _pendingValueUpdate: { sessionId: string; values: Record<string, unknown> } | null = null;

	// Reactive state using Svelte 5 runes
	connected = $state(false);
	isSolving = $state(false);

	constructor(private url: string = 'ws://localhost:8765') {
		// Register internal handler for solving state
		this.on('solvingState', (data) => {
			if (data && typeof data === 'object' && 'isSolving' in data) {
				this.isSolving = Boolean(data.isSolving);
				console.log(`[WebSocket] Grasshopper solving state: ${this.isSolving}`);

				// If solving just finished and we have a pending update, send it
				if (!this.isSolving && this._pendingValueUpdate) {
					console.log('[WebSocket] Sending queued value update');
					this.send('valueUpdate', this._pendingValueUpdate);
					this._pendingValueUpdate = null;
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
					console.log('[WebSocket] Connected to Grasshopper');
					this.reconnectAttempts = 0;
					this.isConnecting = false;
					this.connected = true;
					resolve(true);
				};

				this.socket.onmessage = (event) => {
					try {
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
					console.log('[WebSocket] Disconnected');
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

		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}

		this.reconnectAttempts = 0;
		this.connected = false;
	}

	/**
	 * Send a message to the server
	 */
	send(type: string, data: Record<string, unknown>) {
		if (this.socket?.readyState === WebSocket.OPEN) {
			const message = { type, ...data };
			this.socket.send(JSON.stringify(message));
		} else {
			console.warn('[WebSocket] Cannot send message - not connected');
		}
	}

	/**
	 * Send value updates to Grasshopper
	 * If Grasshopper is currently solving, the update will be queued and sent when solving completes
	 */
	sendValueUpdate(sessionId: string, values: Record<string, unknown>) {
		if (this.isSolving) {
			// Queue the update - only keep the latest one
			console.log('[WebSocket] Grasshopper is solving, queuing value update');
			this._pendingValueUpdate = { sessionId, values };
			return;
		}

		console.log('[WebSocket] Sending value update:', values);
		this.send('valueUpdate', { sessionId, values });
	}

	/**
	 * Request current values from Grasshopper
	 */
	requestCurrentValues(sessionId: string) {
		console.log('[WebSocket] Requesting current values from Grasshopper');
		this.send('requestCurrentValues', { sessionId });
	}

	/**
	 * Request initial data (schema, available params, current values) from Grasshopper
	 */
	requestInitialData(sessionId: string) {
		console.log('[WebSocket] Requesting initial data from Grasshopper');
		this.send('requestInitialData', { sessionId });
	}

	/**
	 * Save schema to Grasshopper
	 */
	saveSchema(sessionId: string, schema: UISchema) {
		this.send('saveSchema', { sessionId, schema });
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
				console.log(
					'[WebSocket] Server is disconnecting:',
					(msg.data as { reason?: string } | undefined)?.reason || 'No reason provided'
				);
				if (this.reconnectTimer) {
					clearTimeout(this.reconnectTimer);
					this.reconnectTimer = null;
				}
				this.reconnectAttempts = this.maxReconnectAttempts;
				return;
			}

			const handlers = this.messageHandlers.get(msg.type);
			if (handlers) {
				handlers.forEach((handler) => handler(msg));
			}
		}
	}

	/**
	 * Attempt to reconnect with exponential backoff
	 */
	private attemptReconnect() {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.log('[WebSocket] Max reconnection attempts reached');
			return;
		}

		this.reconnectAttempts++;
		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

		console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, delay);
	}
}

// Singleton instance
let wsState: WebSocketState | null = null;

/**
 * Get or create the WebSocket state instance (singleton)
 */
export function getWebSocketState(): WebSocketState {
	if (!wsState) {
		wsState = new WebSocketState();
	}
	return wsState;
}
