import { error } from '@sveltejs/kit';
import { ProviderError } from '@selvajs/platform';
import type { ZodError } from 'zod';
import { SchemaExtractionError } from './definitions/schemaExtraction.server';

function isSvelteKitError(err: unknown): err is { status: number; body: unknown } {
	return !!err && typeof err === 'object' && 'status' in err && 'body' in err;
}

// Postgres unique-constraint names → friendly explanations. Postgrest surfaces
// the constraint name verbatim ("duplicate key value violates unique
// constraint \"foo_key\""), which is useless to end users.
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
	projects_org_name_unique: 'A project with that name already exists in this organization.',
	projects_org_id_slug_key: 'A project with that name already exists in this organization.',
	orgs_slug_key: 'An organization with that slug already exists.',
	definitions_pkey: 'A definition with that ID already exists.'
};

function friendlyConstraintMessage(raw: string): string | null {
	for (const [name, msg] of Object.entries(UNIQUE_CONSTRAINT_MESSAGES)) {
		if (raw.includes(name)) return msg;
	}
	return null;
}

/**
 * Normalize any error raised inside an API handler to a SvelteKit HTTP error.
 * Re-throws existing SvelteKit errors unchanged, maps ProviderError to its
 * statusCode, and falls back to a 500 with the provided message.
 */
export function handleApiError(err: unknown, fallback: string): never {
	if (isSvelteKitError(err)) throw err;
	// Schema extraction is the upload validation gate (specs/SchemaCaching.md):
	// compute unreachable → 503, no valid Schema output → 422.
	if (err instanceof SchemaExtractionError) {
		throw error(err.kind === 'unreachable' ? 503 : 422, err.message);
	}
	if (err instanceof ProviderError) {
		const friendly = friendlyConstraintMessage(err.message);
		throw error(err.statusCode, friendly ?? err.message);
	}
	console.error(`[API] ${fallback}:`, err);
	throw error(500, fallback);
}

/** Throw a 400 with the first issue message from a Zod error. */
export function throwZodError(err: ZodError): never {
	const issue = err.issues[0];
	const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
	throw error(400, `${path}${issue.message}`);
}
