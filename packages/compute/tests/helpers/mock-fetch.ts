interface MockResponseOptions {
	ok?: boolean;
	status?: number;
	statusText?: string;
	/** Response headers (e.g. { 'Retry-After': '2' }). */
	headers?: Record<string, string>;
	/**
	 * Raw response body, returned verbatim by `text()`: use this for non-JSON or
	 * partial-success bodies. When omitted, the body is `JSON.stringify(data)`.
	 */
	body?: string;
}

/**
 * Creates a mock fetch Response for testing. Includes a real `Headers` object
 * so transport code that does `response.headers.forEach(...)` /
 * `response.headers.get(...)` works as it would against a real Response.
 *
 * It has no `body` stream, so `readBodyText` never takes its streaming path:
 * use a real `new Response(...)` to reach it.
 */
export function createMockResponse(data: unknown, options: MockResponseOptions = {}): Response {
	const { ok = true, status = 200, statusText = 'OK', headers = {}, body } = options;
	const text = body ?? JSON.stringify(data);

	return {
		ok,
		status,
		statusText,
		headers: new Headers(headers),
		text: async () => text
	} as Response;
}
