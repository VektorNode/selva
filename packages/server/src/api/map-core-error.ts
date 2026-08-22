/**
 * The domain errors this package's own handlers raise, folded into the envelope.
 *
 * A host's `mapError` should call this first and add only its own error types.
 * These rules cannot live solely in a host: the handler that throws them ships
 * from here, so a host that forgot one would serve 500 where every other host
 * serves 503 — the same API answering differently depending on who mounted it.
 *
 * Postgres surfaces a unique-constraint name verbatim, which is useless to an
 * end user, so the constraints this package's handlers can trip are translated
 * here rather than left to each host.
 */

import { ApiError, ApiErrorCode, codeForStatus } from './errors.js';
import { ComputeServerUnconfiguredError } from '../compute/errors.js';
import { SchemaExtractionError } from '../definitions/schema-extraction.js';
import { ProviderError } from '@selvajs/platform';

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
 * Compute unreachable or serving an unreadable schema is operator-side (503); a
 * schema the parser cannot read is the caller's file (422).
 */
export function mapCoreError(err: unknown): ApiError | undefined {
	if (err instanceof SchemaExtractionError) {
		return err.kind === 'unreachable' || err.kind === 'malformed'
			? new ApiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message)
			: new ApiError(422, ApiErrorCode.UNPROCESSABLE, err.message);
	}
	if (err instanceof ComputeServerUnconfiguredError) {
		return new ApiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
	}
	if (err instanceof ProviderError) {
		const friendly = friendlyConstraintMessage(err.message);
		return new ApiError(err.statusCode, codeForStatus(err.statusCode), friendly ?? err.message);
	}
	return undefined;
}
