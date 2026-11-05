// The unit system an .slvm's coordinates are in, kept in an EXTN chunk of namespace "selva.units"
// (byte layout in Plugin/Selva.Slva/Container/SlvmDocument.cs). A wire frame carries none, since
// `modelUnits` travels beside it, so a recording has to be stamped to say what it was drawn in.

const EXTN = 0x4e545845;
const NAMESPACE = 'selva.units';
const HEADER_BYTES = 12;

/** @param {number} length */
const padded = (length) => length + ((4 - (length % 4)) % 4);

/**
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
export function readModelUnits(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = HEADER_BYTES;
	for (let i = 0, count = view.getUint32(8, true); i < count; i++) {
		const type = view.getUint32(offset, true);
		const length = view.getUint32(offset + 4, true);
		offset += 8;
		if (type === EXTN) {
			// Namespaces are short, so the varint length is a single byte.
			const nsLength = bytes[offset];
			const ns = new TextDecoder().decode(bytes.subarray(offset + 1, offset + 1 + nsLength));
			if (ns === NAMESPACE) {
				return new TextDecoder().decode(bytes.subarray(offset + 1 + nsLength, offset + length));
			}
		}
		offset += padded(length);
	}
	return null;
}

/**
 * @param {Uint8Array} bytes
 * @param {string} units
 * @returns {Uint8Array}
 */
export function stampModelUnits(bytes, units) {
	if (readModelUnits(bytes) !== null) return bytes;
	const ns = new TextEncoder().encode(NAMESPACE);
	const body = new TextEncoder().encode(units);
	const payload = new Uint8Array(1 + ns.length + body.length);
	payload[0] = ns.length;
	payload.set(ns, 1);
	payload.set(body, 1 + ns.length);

	const out = new Uint8Array(bytes.length + 8 + padded(payload.length));
	out.set(bytes);
	const view = new DataView(out.buffer);
	view.setUint32(8, view.getUint32(8, true) + 1, true);
	view.setUint32(bytes.length, EXTN, true);
	view.setUint32(bytes.length + 4, payload.length, true);
	out.set(payload, bytes.length + 8);
	return out;
}
