// Saves and picks for the Rhino panel, whose WebView can't download a file or show a file picker
// safely. The plugin shows the native dialog, and the file travels in one binary frame
// (host-frame.ts). Every request gets exactly one reply, matched by requestId.

import { encodeHostFrame } from './host-frame';

/** The slice of WebSocketState this needs; a fake stands in for it in tests. */
export interface HostFileSocket {
	readonly connected: boolean;
	send(type: string, data: Record<string, unknown>): void;
	sendBinary(data: Blob): void;
	on(type: string, handler: (data: unknown) => void): void;
}

/** Failures worth showing the user as they are: the plugin's reason, or why it was never asked. */
export class HostFileError extends Error {}

type Reply =
	| { type: 'hostSaveFileResult'; outcome: 'saved' | 'cancelled' | 'failed'; error?: string | null }
	| { type: 'hostPickFileResult'; outcome: 'cancelled' | 'failed'; error?: string | null }
	| { type: 'hostPickedFile'; name: string; body: ArrayBuffer };

const NOT_CONNECTED = 'Not connected to Grasshopper.';
const CONNECTION_LOST = 'Lost the connection to Grasshopper before the file dialog answered.';

export function createHostFilesClient(
	socket: HostFileSocket,
	getSessionId: () => string,
	maxFileBytes: number
) {
	let lastRequestId = 0;
	const pending = new Map<
		string,
		{ resolve: (reply: Reply) => void; reject: (e: Error) => void }
	>();

	// The dispatcher has validated each reply against messageSchemas.ts.
	const settle = (data: unknown) => {
		const reply = data as Reply & { requestId: string };
		const request = pending.get(reply.requestId);
		if (!request) return;
		pending.delete(reply.requestId);
		request.resolve(reply);
	};

	socket.on('hostSaveFileResult', settle);
	socket.on('hostPickFileResult', settle);
	socket.on('hostPickedFile', settle);
	socket.on('socketClosed', () => {
		for (const request of pending.values()) request.reject(new HostFileError(CONNECTION_LOST));
		pending.clear();
	});

	function request(send: (requestId: string) => void): Promise<Reply> {
		if (!socket.connected) return Promise.reject(new HostFileError(NOT_CONNECTED));
		const requestId = String(++lastRequestId);
		return new Promise<Reply>((resolve, reject) => {
			pending.set(requestId, { resolve, reject });
			send(requestId);
		});
	}

	return {
		/** Resolves false when the user cancelled; throws {@link HostFileError} when the save failed. */
		async saveBlob(blob: Blob, fileName: string): Promise<boolean> {
			if (blob.size > maxFileBytes) {
				throw new HostFileError(
					`The file is larger than ${Math.floor(maxFileBytes / (1024 * 1024))} MB. ` +
						'Use Open UI in Browser to save it.'
				);
			}

			const reply = await request((requestId) =>
				socket.sendBinary(
					encodeHostFrame(
						{ type: 'hostSaveFile', sessionId: getSessionId(), requestId, fileName },
						blob
					)
				)
			);
			if (reply.type === 'hostSaveFileResult' && reply.outcome === 'failed') {
				throw new HostFileError(reply.error || 'Could not save the file.');
			}
			return reply.type === 'hostSaveFileResult' && reply.outcome === 'saved';
		},

		/** Resolves null when the user cancelled; throws {@link HostFileError} when the pick failed. */
		async pickFile({ accept }: { accept: string }): Promise<File | null> {
			const reply = await request((requestId) =>
				socket.send('hostPickFile', {
					sessionId: getSessionId(),
					requestId,
					accept: accept
						.split(',')
						.map((entry) => entry.trim())
						.filter(Boolean)
				})
			);
			if (reply.type === 'hostPickedFile') return new File([reply.body], reply.name);
			if (reply.outcome === 'failed') {
				throw new HostFileError(reply.error || 'Could not open the file.');
			}
			return null;
		}
	};
}
