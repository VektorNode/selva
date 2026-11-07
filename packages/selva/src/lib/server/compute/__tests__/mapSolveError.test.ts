/**
 * A caller retries a 503 or 504 and reports a 500, so the line between "compute is down"
 * and "the solve broke" decides what an operator gets paged for.
 */

import { describe, expect, it } from 'vitest';
import { ComputeError, ErrorCodes } from '@selvajs/compute/core';
import { ApiError, ApiErrorCode } from '@selvajs/server/api';
import { ComputeServerUnconfiguredError } from '@selvajs/server/compute';
import { silentLog } from '#lib/server/__tests__/fixtures.js';
import { mapSolveError } from '../solve.server.js';

function mapped(err: unknown): { status: number; code?: string } {
	try {
		mapSolveError(err, { log: silentLog } as unknown as App.Locals);
	} catch (thrown) {
		const { status, body } = thrown as { status: number; body?: { code?: string } };
		return { status, code: body?.code };
	}
	throw new Error('mapSolveError returned');
}

describe('mapSolveError', () => {
	it.each([
		['no compute server configured', new ComputeServerUnconfiguredError()],
		['an unreachable server', new ComputeError('down', ErrorCodes.NETWORK_ERROR)],
		['a CORS failure', new ComputeError('cors', ErrorCodes.CORS_ERROR)],
		['rejected credentials', new ComputeError('401', ErrorCodes.AUTH_ERROR)],
		['a rate-limiting server', new ComputeError('429', ErrorCodes.RATE_LIMIT)],
		['a raw fetch failure', new TypeError('fetch failed')]
	])('answers 503 COMPUTE_UNAVAILABLE for %s', (_, err) => {
		expect(mapped(err)).toEqual({ status: 503, code: 'COMPUTE_UNAVAILABLE' });
	});

	it('answers 504 when the compute server times out', () => {
		expect(mapped(new ComputeError('slow', ErrorCodes.TIMEOUT_ERROR))).toEqual({
			status: 504,
			code: 'COMPUTE_UNAVAILABLE'
		});
	});

	it('answers 500 for a solve that genuinely failed', () => {
		expect(mapped(new ComputeError('bad tree', ErrorCodes.UNKNOWN_ERROR))).toEqual({
			status: 500,
			code: 'INTERNAL'
		});
		expect(mapped(new Error('boom'))).toEqual({ status: 500, code: 'INTERNAL' });
	});

	it("keeps a guard's own refusal instead of turning it into a 500", () => {
		expect(mapped(new ApiError(403, ApiErrorCode.FORBIDDEN, 'no'))).toEqual({
			status: 403,
			code: 'FORBIDDEN'
		});
	});
});
