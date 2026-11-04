/**
 * Gzip request bodies, but only for a server that advertised it: its last response carried
 * `Accept-Encoding: gzip` (RFC 7694), as Rhino.Compute does with `RHINO_COMPUTE_COMPRESSION` on.
 * An older server reads a gzipped body as malformed JSON. A response without the header forgets
 * the server, so one failed request recovers from compression being turned off. Browsers only
 * learn it same-origin: CORS hides the header otherwise.
 */
const gzipServers = new Set<string>();

/** Smaller bodies gain too little; the server uses the same cut-off for its responses. */
export const GZIP_MIN_BYTES = 1024;

export function noteRequestEncodings(serverUrl: string, response: Response): void {
	const accepted = response.headers?.get('Accept-Encoding');
	if (accepted && /(^|[\s,])gzip($|[\s,;])/i.test(accepted)) gzipServers.add(serverUrl);
	else gzipServers.delete(serverUrl);
}

/** Synchronous, so an uncompressed request reaches fetch in the same tick as before. */
export function shouldGzipRequest(serverUrl: string, byteLength: number): boolean {
	return (
		byteLength >= GZIP_MIN_BYTES &&
		gzipServers.has(serverUrl) &&
		typeof CompressionStream !== 'undefined'
	);
}

export async function gzip(body: string): Promise<Uint8Array<ArrayBuffer>> {
	const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
