/**
 * WebSocket client for real-time communication with Grasshopper (local mode only)
 * Uses Svelte 5 runes for reactive state management
 */

import {
  WEBSOCKET_MAX_RECONNECT_ATTEMPTS,
  WEBSOCKET_RECONNECT_INTERVAL,
  WEBSOCKET_URL,
} from '$lib/app.config';
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
  private maxReconnectAttempts = WEBSOCKET_MAX_RECONNECT_ATTEMPTS;
  private reconnectDelay = WEBSOCKET_RECONNECT_INTERVAL;
  private isConnecting = false;
  private _pendingValueUpdate: { sessionId: string; values: Record<string, unknown> } | null = null;
  private _serverDisconnected = false;
  private _shouldReloadOnReconnect = false;
  private solvingTimeout: ReturnType<typeof setTimeout> | null = null;

  // Reactive state using Svelte 5 runes
  connected = $state(false);
  isSolving = $state(false);

  constructor(private url: string = WEBSOCKET_URL) {
    this.on('solvingState', (data) => {
      if (data && typeof data === 'object' && 'isSolving' in data) {
        const newState = Boolean(data.isSolving);

        // Only log and process if state actually changed
        if (newState !== this.isSolving) {
          console.info(`[WebSocket] Grasshopper solving state: ${newState} (was: ${this.isSolving})`);
          this.isSolving = newState;

          // Clear any pending timeout when we get an explicit solving state update
          if (this.solvingTimeout) {
            clearTimeout(this.solvingTimeout);
            this.solvingTimeout = null;
          }

          // If solving just finished and we have a pending update, send it
          if (!this.isSolving && this._pendingValueUpdate) {
            console.log('[WebSocket] Solving completed, sending pending value update');
            this.send('valueUpdate', this._pendingValueUpdate);
            this._pendingValueUpdate = null;
          }
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
            console.warn('[WebSocket] Server is back online, reloading page...');
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
            // Skip empty or invalid messages
            if (!event.data || typeof event.data !== 'string' || event.data.trim() === '') {
              console.warn('[WebSocket] Received empty or invalid message, skipping');
              return;
            }

            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            // Log the raw message for debugging, but truncate if too long
            const rawData = event.data?.toString() || '';
            const preview = rawData.length > 100 ? rawData.substring(0, 100) + '...' : rawData;
            console.error('[WebSocket] Failed to parse message:', error);
            console.debug('[WebSocket] Raw message data:', preview);
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
        console.warn(
          '[WebSocket] Server is disconnecting:',
          (msg.data as { reason?: string } | undefined)?.reason || 'No reason provided'
        );
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
      console.log(`[WebSocket] Server disconnected, retrying in ${fixedDelay}ms`);

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, fixedDelay);
      return;
    }

    // Otherwise, use exponential backoff with max attempts
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
