/**
 * SHA-256 for cache keys that callers may try to forge: a key shared across users must not be
 * collidable on purpose, which rules out a fast non-cryptographic hash.
 *
 * Strings hash as their UTF-16LE code units. UTF-8 would fold every lone surrogate into U+FFFD,
 * so two different strings would hash alike.
 */

type NodeCrypto = typeof import('node:crypto');

// `getBuiltinModule` is synchronous, so Node gets native hashing without a top-level import that
// would break browser bundles. Everywhere else takes the portable path.
const nodeCrypto = (
	globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
).process?.getBuiltinModule?.('node:crypto') as NodeCrypto | undefined;

/** Lowercase hex SHA-256 of `input`. */
export function sha256Hex(input: string | Uint8Array): string {
	if (nodeCrypto) {
		const hash = nodeCrypto.createHash('sha256');
		if (typeof input === 'string') hash.update(input, 'utf16le');
		else hash.update(input);
		return hash.digest('hex');
	}
	return sha256HexPortable(input);
}

// ============================================================================
// Portable implementation (FIPS 180-4)
// ============================================================================

const K = new Int32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** @internal Exported so tests can check it against Node's native hash. */
export function sha256HexPortable(input: string | Uint8Array): string {
	const state = new Sha256();
	if (typeof input === 'string') state.updateString(input);
	else state.update(input);
	return state.digestHex();
}

class Sha256 {
	private readonly h = new Int32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
	]);
	private readonly w = new Int32Array(64);
	private readonly pending = new Uint8Array(64);
	private pendingLength = 0;
	private totalBytes = 0;

	update(bytes: Uint8Array): void {
		this.totalBytes += bytes.length;
		let offset = 0;
		if (this.pendingLength > 0) {
			const take = Math.min(64 - this.pendingLength, bytes.length);
			this.pending.set(bytes.subarray(0, take), this.pendingLength);
			this.pendingLength += take;
			offset = take;
			if (this.pendingLength < 64) return;
			this.compressBytes(this.pending, 0);
			this.pendingLength = 0;
		}
		for (; offset + 64 <= bytes.length; offset += 64) this.compressBytes(bytes, offset);
		this.pending.set(bytes.subarray(offset), 0);
		this.pendingLength = bytes.length - offset;
	}

	/**
	 * Feed a string's UTF-16LE bytes straight into the message words, skipping a byte buffer.
	 * Only on a fresh state: 32 code units fill a block exactly, so nothing may be pending.
	 */
	updateString(s: string): void {
		const w = this.w;
		const whole = s.length - (s.length % 32);
		for (let offset = 0; offset < whole; offset += 32) {
			for (let i = 0; i < 16; i++) {
				const c0 = s.charCodeAt(offset + 2 * i);
				const c1 = s.charCodeAt(offset + 2 * i + 1);
				w[i] = ((c0 & 0xff) << 24) | ((c0 >>> 8) << 16) | ((c1 & 0xff) << 8) | (c1 >>> 8);
			}
			this.compress();
		}
		this.totalBytes += whole * 2;

		const rest = new Uint8Array((s.length - whole) * 2);
		for (let i = whole, j = 0; i < s.length; i++) {
			const code = s.charCodeAt(i);
			rest[j++] = code & 0xff;
			rest[j++] = code >>> 8;
		}
		this.update(rest);
	}

	digestHex(): string {
		const bitLength = this.totalBytes * 8;
		const tail = new Uint8Array(this.pendingLength < 56 ? 64 : 128);
		tail.set(this.pending.subarray(0, this.pendingLength));
		tail[this.pendingLength] = 0x80;
		const view = new DataView(tail.buffer);
		view.setUint32(tail.length - 8, Math.floor(bitLength / 0x100000000));
		view.setUint32(tail.length - 4, bitLength >>> 0);
		for (let offset = 0; offset < tail.length; offset += 64) this.compressBytes(tail, offset);

		let hex = '';
		for (const word of this.h) hex += (word >>> 0).toString(16).padStart(8, '0');
		return hex;
	}

	private compressBytes(bytes: Uint8Array, offset: number): void {
		const w = this.w;
		for (let i = 0; i < 16; i++) {
			const j = offset + i * 4;
			w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
		}
		this.compress();
	}

	/** One block, from the 16 message words already in `w`. */
	private compress(): void {
		const w = this.w;
		for (let i = 16; i < 64; i++) {
			const x = w[i - 15];
			const y = w[i - 2];
			const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
			const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
		}

		const h = this.h;
		let a = h[0];
		let b = h[1];
		let c = h[2];
		let d = h[3];
		let e = h[4];
		let f = h[5];
		let g = h[6];
		let k = h[7];
		for (let i = 0; i < 64; i++) {
			const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			const ch = (e & f) ^ (~e & g);
			const t1 = (k + S1 + ch + K[i] + w[i]) | 0;
			const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) | 0;
			k = g;
			g = f;
			f = e;
			e = (d + t1) | 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) | 0;
		}
		h[0] = (h[0] + a) | 0;
		h[1] = (h[1] + b) | 0;
		h[2] = (h[2] + c) | 0;
		h[3] = (h[3] + d) | 0;
		h[4] = (h[4] + e) | 0;
		h[5] = (h[5] + f) | 0;
		h[6] = (h[6] + g) | 0;
		h[7] = (h[7] + k) | 0;
	}
}
