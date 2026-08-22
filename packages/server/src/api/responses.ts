/**
 * Response shapes shared by every handler.
 *
 * The pagination envelope in particular: a resource-named key would force each
 * client to write one unwrapper per endpoint instead of one pagination helper,
 * so every list endpoint returns `{ items, nextCursor? }` through `collection`
 * rather than assembling it by hand.
 */

import type { ApiResponse } from './types.js';

/** A paginated collection. The one envelope every list endpoint returns. */
export function collection<T>(page: { items: T[]; nextCursor?: string }): ApiResponse {
	return { body: { items: page.items, nextCursor: page.nextCursor } };
}

/** A created resource. */
export function created<T>(body: T): ApiResponse {
	return { status: 201, body };
}

/** A successful mutation with nothing to say. */
export function noContent(): ApiResponse {
	return { status: 204 };
}
