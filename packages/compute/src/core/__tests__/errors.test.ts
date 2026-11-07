import { describe, expect, it } from 'vitest';

import { ErrorCodes } from '../errors';

describe('ErrorCodes', () => {
	// Consumers switch on these strings: renaming or dropping one breaks them at runtime with no
	// type error on their side, so it needs a major release. A new code is added here too.
	it('keeps every published code and its value', () => {
		expect(Object.entries(ErrorCodes)).toEqual([
			['NETWORK_ERROR', 'NETWORK_ERROR'],
			['AUTH_ERROR', 'AUTH_ERROR'],
			['VALIDATION_ERROR', 'VALIDATION_ERROR'],
			['COMPUTATION_ERROR', 'COMPUTATION_ERROR'],
			['TIMEOUT_ERROR', 'TIMEOUT_ERROR'],
			['CORS_ERROR', 'CORS_ERROR'],
			['NOT_FOUND', 'NOT_FOUND'],
			['RATE_LIMIT', 'RATE_LIMIT'],
			['INVALID_RESPONSE', 'INVALID_RESPONSE'],
			['RESPONSE_TOO_LARGE', 'RESPONSE_TOO_LARGE'],
			['UNKNOWN_ERROR', 'UNKNOWN_ERROR'],
			['INVALID_STATE', 'INVALID_STATE'],
			['INVALID_INPUT', 'INVALID_INPUT'],
			['INVALID_CONFIG', 'INVALID_CONFIG'],
			['BROWSER_ONLY', 'BROWSER_ONLY'],
			['ENVIRONMENT_ERROR', 'ENVIRONMENT_ERROR'],
			['ENCODING_ERROR', 'ENCODING_ERROR'],
			['MALFORMED_DEFAULT', 'MALFORMED_DEFAULT'],
			['SUPERSEDED', 'SUPERSEDED'],
			['ABORTED', 'ABORTED'],
			['QUEUE_FULL', 'QUEUE_FULL'],
			['QUEUE_TIMEOUT', 'QUEUE_TIMEOUT'],
			['DEFINITION_NOT_CACHED', 'DEFINITION_NOT_CACHED']
		]);
	});
});
