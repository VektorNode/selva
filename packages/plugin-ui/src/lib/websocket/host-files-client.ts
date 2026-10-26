// Saves and picks for the Rhino panel, whose WebView can't download a file or show a file picker
// safely. The plugin shows the native dialog, and the file travels in one binary frame
// (host-frame.ts).

import { encodeHostFrame } from './host-frame';
import { createPendingRequests, type ReplySocket } from './pending-requests';

/** The slice of WebSocketState this needs; a fake stands in for it in tests. */
export interface HostFileSocket extends ReplySocket {
	readonly connected: boolean;
	send(type: string, data: Record<string, unknown>): void;
	sendBinary(data: Blob): void;
}

/** Failures worth showing the user as they are: the plugin's reason, or why it was never asked. */
export class HostFileError extends Error {}

type Reply = { requestId: string } & (
	| { type: 'hostSaveFileResult'; outcome: 'saved' | 'cancelled' | 'failed'; error?: string | null }
	| { type: 'hostPickFileResult'; outcome: 'cancelled' | 'failed'; error?: string | null }
	| { type: 'hostPickedFile'; name: string; body: ArrayBuffer }
);

const NOT_CONNECTED = 'Not connected to Grasshopper.';
const CONNECTION_LOST = 'Lost the connection to Grasshopper before the file dialog answered.';

export function createHostFilesClient(
	socket: HostFileSocket,
	getSessionId: () => string,
	maxFileBytes: number
) {
	const pending = createPendingRequests<Reply>(socket, {
		replyTypes: ['hostSaveFileResult', 'hostPickFileResult', 'hostPickedFile'],
		connectionLost: () => new HostFileError(CONNECTION_LOST)
	});

	function request(send: (requestId: string) => void): Promise<Reply> {
		if (!socket.connected) return Promise.reject(new HostFileError(NOT_CONNECTED));
		return pending.request(send);
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
