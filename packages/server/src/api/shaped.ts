/**
 * Serializing a response through an explicit schema.
 *
 * **This is what keeps a secret from reaching a client by accident.** Several
 * responses are store records with a credential removed — `tokenHash` on a
 * share link or invite, `apiKey` on an org compute server. Parsing through a
 * schema means the response carries only what the schema names, so a new field
 * on the stored type is invisible until someone adds it here deliberately.
 *
 * Returning the record directly would put a credential hash on the wire with
 * nothing failing at build time, which is why these live beside the handler
 * contract rather than in each host.
 */

import type { ZodType } from 'zod';
import type { ApiResponse } from './types.js';

/** Serialize a payload through an explicit response schema. */
export function shaped<T>(schema: ZodType<T>, payload: unknown, status = 200): ApiResponse {
	// A response failing its own schema is a bug in the handler, not bad caller
	// input — let it surface as a 500 rather than ship a half-valid body.
	return { status, body: schema.parse(payload) };
}

/** `shaped`, mapped over a page of records. */
export function shapedCollection<T>(
	schema: ZodType<T>,
	page: { items: unknown[]; nextCursor?: string }
): ApiResponse {
	return {
		body: {
			items: page.items.map((item) => schema.parse(item)),
			nextCursor: page.nextCursor
		}
	};
}
