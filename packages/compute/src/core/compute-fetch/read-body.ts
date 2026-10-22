import { utf8ByteLength } from '../utils/encoding';

/**
 * Cap on an error body: it is read for its `code` and message only. A 500 is read in full instead,
 * since a partial success carries the computed values.
 */
export const ERROR_BODY_MAX_BYTES = 1 << 20;

export interface BodyText {
	text: string;
	/** The body passed the limit. `text` holds only what arrived before the cut. */
	truncated: boolean;
}

/** Read a body as text, cancelling the download once it passes `limit` UTF-8 bytes. */
export async function readBodyText(response: Response, limit = Infinity): Promise<BodyText> {
	if (limit === Infinity) return { text: await response.text(), truncated: false };

	// A body without a stream can't be cut short: read it, then apply the limit.
	if (!response.body) {
		const text = await response.text();
		return { text, truncated: utf8ByteLength(text) > limit };
	}

	// Refuse a declared oversize body unread. Not when compressed: the header then counts the
	// compressed bytes, not the ones read.
	const declared = Number(response.headers.get('Content-Length'));
	if (!response.headers.has('Content-Encoding') && declared > limit) {
		await response.body.cancel().catch(() => {});
		return { text: '', truncated: true };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parts: string[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		parts.push(decoder.decode(value, { stream: true }));
		if (received > limit) {
			await reader.cancel().catch(() => {});
			return { text: parts.join(''), truncated: true };
		}
	}
	parts.push(decoder.decode());
	return { text: parts.join(''), truncated: false };
}
