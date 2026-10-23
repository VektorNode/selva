// The plugin's HostFileFrameTests write and read the same fixture, so the two codecs can't drift.
// Its header is host-picked-file.json and its body is every byte value 0–255 once, in order.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeHostFrame, encodeHostFrame, isHostFrame } from '../host-frame';

const wireDir = new URL('../../../../../schemas/fixtures/wire/', import.meta.url);
const fixtureBytes = readFileSync(new URL('host-picked-file.slhf', wireDir));
const fixture = fixtureBytes.buffer.slice(
	fixtureBytes.byteOffset,
	fixtureBytes.byteOffset + fixtureBytes.byteLength
);
const expectedHeader = JSON.parse(readFileSync(new URL('host-picked-file.json', wireDir), 'utf-8'));
const expectedBody = Uint8Array.from({ length: 256 }, (_, i) => i);

describe('host file frame (cross-stack with HostFileFrameTests)', () => {
	it('decodes the frame the plugin writes', () => {
		const frame = decodeHostFrame(fixture);

		expect(frame?.header).toEqual(expectedHeader);
		expect(new Uint8Array(frame!.body)).toEqual(expectedBody);
	});

	it('encodes the same bytes the plugin writes', async () => {
		const encoded = encodeHostFrame(expectedHeader, new Blob([expectedBody]));

		expect(new Uint8Array(await encoded.arrayBuffer())).toEqual(new Uint8Array(fixture));
	});

	it('leaves mesh blobs to the mesh collector', () => {
		const slva = new TextEncoder().encode('SLVA....').buffer;

		expect(isHostFrame(slva)).toBe(false);
		expect(decodeHostFrame(slva)).toBeNull();
	});

	it('refuses a frame whose header runs past its end or is not an object', async () => {
		const pastTheEnd = fixture.slice(0);
		new DataView(pastTheEnd).setUint32(4, 0xffff, true);

		const arrayHeader = await encodeHostFrame({}, new Blob()).arrayBuffer();
		const notAnObject = new Uint8Array([
			...new Uint8Array(arrayHeader, 0, 4),
			2,
			0,
			0,
			0,
			...new TextEncoder().encode('[]')
		]).buffer;

		expect(decodeHostFrame(pastTheEnd)).toBeNull();
		expect(decodeHostFrame(notAnObject)).toBeNull();
		expect(decodeHostFrame(fixture.slice(0, 7))).toBeNull();
	});
});
