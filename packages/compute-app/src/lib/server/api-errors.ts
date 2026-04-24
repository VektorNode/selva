import { error } from '@sveltejs/kit';
import { ProviderError } from '@selva/platform';
import type { ZodError } from 'zod';

function isSvelteKitError(err: unknown): err is { status: number; body: unknown } {
	return !!err && typeof err === 'object' && 'status' in err && 'body' in err;
}

/**
 * Normalize any error raised inside an API handler to a SvelteKit HTTP error.
 * Re-throws existing SvelteKit errors unchanged, maps ProviderError to its
 * statusCode, and falls back to a 500 with the provided message.
 */
export function handleApiError(err: unknown, fallback: string): never {
	if (isSvelteKitError(err)) throw err;
	if (err instanceof ProviderError) throw error(err.statusCode, err.message);
	console.error(`[API] ${fallback}:`, err);
	throw error(500, fallback);
}

/** Throw a 400 with the first issue message from a Zod error. */
export function throwZodError(err: ZodError): never {
	const issue = err.issues[0];
	const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
	throw error(400, `${path}${issue.message}`);
}
