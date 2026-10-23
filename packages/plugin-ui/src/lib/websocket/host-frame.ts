// A file and its envelope in one binary frame, both ways between the Rhino panel and the plugin:
//
//   offset  size      field
//   0       4         magic "SLHF" (ASCII)
//   4       4         header length N, uint32 little-endian
//   8       N         header: UTF-8 JSON, an ordinary envelope with type and sessionId
//   8+N     the rest  the file's bytes
//
// The plugin's HostFileFrame.cs writes the same layout. Both read
// packages/schemas/fixtures/wire/host-picked-file.slhf.

const MAGIC = [0x53, 0x4c, 0x48, 0x46];
const PREFIX_LENGTH = 8;

export type HostFrame = { header: Record<string, unknown>; body: ArrayBuffer };

/** True when the frame starts with the magic; mesh blobs start `SLVA`, `SLVZ` or `SLVM`. */
export function isHostFrame(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength < MAGIC.length) return false;
	const bytes = new Uint8Array(buffer, 0, MAGIC.length);
	return MAGIC.every((byte, i) => bytes[i] === byte);
}

/** Null for anything that isn't a whole frame with a JSON object header. */
export function decodeHostFrame(buffer: ArrayBuffer): HostFrame | null {
	if (buffer.byteLength < PREFIX_LENGTH || !isHostFrame(buffer)) return null;

	const headerLength = new DataView(buffer).getUint32(4, true);
	if (headerLength === 0 || headerLength > buffer.byteLength - PREFIX_LENGTH) return null;

	let header: unknown;
	try {
		header = JSON.parse(
			new TextDecoder().decode(new Uint8Array(buffer, PREFIX_LENGTH, headerLength))
		);
	} catch {
		return null;
	}
	if (typeof header !== 'object' || header === null || Array.isArray(header)) return null;

	return {
		header: header as Record<string, unknown>,
		body: buffer.slice(PREFIX_LENGTH + headerLength)
	};
}

/** A Blob, so the file goes to the socket without being copied into a JS buffer first. */
export function encodeHostFrame(header: Record<string, unknown>, body: Blob): Blob {
	const headerBytes = new TextEncoder().encode(JSON.stringify(header));
	const prefix = new Uint8Array(PREFIX_LENGTH);
	prefix.set(MAGIC);
	new DataView(prefix.buffer).setUint32(4, headerBytes.byteLength, true);
	return new Blob([prefix, headerBytes, body]);
}
