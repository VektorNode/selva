import { describe, expect, it } from 'vitest';
import { ComputeError, ErrorCodes } from '@selvajs/compute/core';

import { computeErrorLogFields } from '../errorLogFields';

const failure = new ComputeError('Server error', ErrorCodes.COMPUTATION_ERROR, {
	statusCode: 500,
	context: { requestId: 'req-1', responseBody: 'quotes an input value' }
});

describe('computeErrorLogFields', () => {
	it('logs identifiers and a size by default, never the body', () => {
		expect(computeErrorLogFields(failure, false)).toEqual({
			computeRequestId: 'req-1',
			computeBodyChars: 21
		});
	});

	it('adds the raw body only when asked', () => {
		expect(computeErrorLogFields(failure, true)).toMatchObject({
			computeResponseBody: 'quotes an input value'
		});
	});

	it('adds nothing for an error from elsewhere', () => {
		expect(computeErrorLogFields(new Error('boom'), true)).toEqual({});
	});
});
