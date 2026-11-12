// ============================================================================
// Keep-alive solve response: wire format
// ============================================================================
//
// A reverse proxy cuts a request whose upstream sends nothing for its read timeout (nginx: 60 s),
// shorter than a long solve. The client opts in with `Prefer: selva-keepalive`; the server then
// answers 200 at once with `Preference-Applied: selva-keepalive` and a body of:
//
//   ' '*             one space now, then one every KEEPALIVE_INTERVAL_MS while the solve runs
//   <meta JSON>\n    the real response's status and headers, as `KeepaliveMeta`
//   <body bytes>     the real response's body, unchanged: a gzip body stays gzip
//
// A server that ignores the preference answers as usual, and the client reads that as is.

export const KEEPALIVE_PREFERENCE = 'selva-keepalive';

/** Under the 30 s many load balancers allow an idle upstream. */
export const KEEPALIVE_INTERVAL_MS = 15_000;

export interface KeepaliveMeta {
	status: number;
	headers: [string, string][];
}
