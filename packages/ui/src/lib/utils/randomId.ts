// Falls back through crypto.randomUUID → crypto.getRandomValues → Math.random so
// plain-HTTP deployments don't crash. Math.random IDs are non-cryptographic:
// fine for collision-resistant UI keys, not for tokens or secrets.
export function randomId(): string {
	const c = typeof crypto !== 'undefined' ? crypto : undefined;
	if (c?.randomUUID) return c.randomUUID();
	if (c?.getRandomValues) return uuidFromBytes(c.getRandomValues(new Uint8Array(16)));
	return uuidFromBytes(mathRandomBytes());
}

function mathRandomBytes(): Uint8Array {
	const out = new Uint8Array(16);
	for (let i = 0; i < 16; i++) out[i] = Math.floor(Math.random() * 256);
	return out;
}

// Format 16 bytes as a UUIDv4 string with the version + variant bits set per
// RFC 4122 §4.4. Same shape as crypto.randomUUID() returns.
function uuidFromBytes(bytes: Uint8Array): string {
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

	const hex: string[] = [];
	for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
	return (
		hex.slice(0, 4).join('') +
		'-' +
		hex.slice(4, 6).join('') +
		'-' +
		hex.slice(6, 8).join('') +
		'-' +
		hex.slice(8, 10).join('') +
		'-' +
		hex.slice(10, 16).join('')
	);
}
