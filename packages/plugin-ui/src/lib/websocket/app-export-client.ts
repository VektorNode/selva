// "Export as app" for the builder. The plugin packs the open definition as a Selva app file
// (.slvx) and sends it back in one binary frame (host-frame.ts). Unlike the host-file messages,
// this works from a browser tab too: the page saves the file itself.

import { createPendingRequests, type ReplySocket } from './pending-requests';

/** The slice of WebSocketState this needs; a fake stands in for it in tests. */
export interface AppExportSocket extends ReplySocket {
	readonly connected: boolean;
	send(type: string, data: Record<string, unknown>): void;
}

/** Failures worth showing the user as they are: the plugin's reason, or why it never answered. */
export class AppExportError extends Error {}

type Reply = { requestId: string } & (
	{ type: 'exportedApp'; body: ArrayBuffer } | { type: 'exportAppFailed'; error?: string | null }
);

const NOT_CONNECTED = 'Not connected to Grasshopper.';
const CONNECTION_LOST = 'Lost the connection to Grasshopper before the app was exported.';
const NO_ANSWER = 'Grasshopper did not answer. If it is solving, try again when it has finished.';

// The plugin never answers a request it refuses or can't read, and it answers late while a solve
// holds Rhino's UI thread.
export const EXPORT_TIMEOUT_MS = 30_000;

export function createAppExportClient(socket: AppExportSocket, getSessionId: () => string) {
	const pending = createPendingRequests<Reply>(socket, {
		replyTypes: ['exportedApp', 'exportAppFailed'],
		connectionLost: () => new AppExportError(CONNECTION_LOST)
	});

	return {
		get connected() {
			return socket.connected;
		},

		/**
		 * The Selva app file. An empty `key` exports it unprotected; `icon` is a base64 PNG or
		 * null. Throws {@link AppExportError} when there is no file to save.
		 */
		async exportApp(name: string, key: string, icon: string | null = null): Promise<Blob> {
			if (!socket.connected) throw new AppExportError(NOT_CONNECTED);

			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new AppExportError(NO_ANSWER)), EXPORT_TIMEOUT_MS);
			});
			const answered = pending.request((requestId) =>
				socket.send('exportApp', {
					sessionId: getSessionId(),
					requestId,
					name,
					...(key ? { key } : {}),
					...(icon ? { icon } : {})
				})
			);

			try {
				const reply = await Promise.race([answered, timedOut]);
				if (reply.type === 'exportAppFailed') {
					throw new AppExportError(reply.error || 'Could not export the app.');
				}
				return new Blob([reply.body], { type: 'application/octet-stream' });
			} finally {
				clearTimeout(timer);
			}
		}
	};
}

export type AppExportClient = ReturnType<typeof createAppExportClient>;
