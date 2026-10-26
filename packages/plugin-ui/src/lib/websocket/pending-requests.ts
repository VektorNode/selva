// Request/reply over the bridge socket: every request gets exactly one reply, matched by
// requestId. Replies go to every page on the bridge, so a requestId must be unique across pages
// and reloads, not just within this one.

/** The slice of WebSocketState this needs; a fake stands in for it in tests. */
export interface ReplySocket {
	on(type: string, handler: (data: unknown) => void): void;
}

export interface PendingRequestsOptions<TReply> {
	replyTypes: readonly string[];
	/** The error each request in flight rejects with when the socket closes. */
	connectionLost: () => Error;
	/** Sees every reply, including those to requests from other pages. */
	onReply?: (reply: TReply) => void;
}

export function createPendingRequests<TReply extends { requestId: string }>(
	socket: ReplySocket,
	{ replyTypes, connectionLost, onReply }: PendingRequestsOptions<TReply>
) {
	const pending = new Map<
		string,
		{ resolve: (reply: TReply) => void; reject: (e: Error) => void }
	>();

	// The dispatcher has validated each reply against messageSchemas.ts.
	const settle = (data: unknown) => {
		const reply = data as TReply;
		onReply?.(reply);
		const request = pending.get(reply.requestId);
		if (!request) return;
		pending.delete(reply.requestId);
		request.resolve(reply);
	};
	for (const type of replyTypes) socket.on(type, settle);
	socket.on('socketClosed', () => {
		for (const request of pending.values()) request.reject(connectionLost());
		pending.clear();
	});

	return {
		get size() {
			return pending.size;
		},

		/** `send` gets the new requestId. */
		request(send: (requestId: string) => void): Promise<TReply> {
			const requestId = crypto.randomUUID();
			return new Promise<TReply>((resolve, reject) => {
				pending.set(requestId, { resolve, reject });
				send(requestId);
			});
		}
	};
}
