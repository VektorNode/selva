/**
 * Error-surfacing seam: what the user actually SEES when the Compute8 server
 * fails. The server's exception handler (compute.geometry Startup.cs) emits:
 *
 *   { "error": "Internal Server Error",
 *     "message": "Invalid argument: <detail>",     // the useful part
 *     "stackTrace": [...] }                          // only when Config.Debug
 *
 * The user-facing message must include the server's `message`, not just the
 * generic "Internal Server Error" label. These pin that.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCompute } from '../compute-fetch';
import { createMockResponse } from '@tests/helpers/mock-fetch';

import { ErrorCodes } from '@/core/errors';

import type { ComputeError } from '@/core/errors';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const config = { serverUrl: 'http://localhost:6500' };

afterEach(() => fetchMock.mockReset());

/** The real Compute8 unhandled-exception body shape. */
function serverException(message: string, withStack = false) {
	return JSON.stringify({
		error: 'Internal Server Error',
		message,
		...(withStack ? { stackTrace: ['at compute.geometry.Foo()', 'at Bar()'] } : {})
	});
}

describe('Compute8 server-exception body is surfaced to the user', () => {
	it('includes the server message, not just "Internal Server Error"', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: serverException('Invalid argument: Radius must be positive')
			})
		);

		await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'COMPUTATION_ERROR',
			statusCode: 500
		});

		// The actionable detail must reach the user, not just the generic label.
		await expect(fetchCompute('grasshopper', {}, config)).rejects.toThrow(
			/Radius must be positive/
		);
	});

	it('surfaces a malformed-JSON server error message', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: serverException('Malformed JSON received: Unexpected character at line 1')
			})
		);

		try {
			await fetchCompute('grasshopper', {}, config);
			throw new Error('should have thrown');
		} catch (e) {
			expect((e as Error).message).toContain('Malformed JSON received');
		}
	});
});

describe('error context.responseBody holds the raw, bounded server body (issue 104)', () => {
	it('stores the raw wire body, not the synthesized message', async () => {
		const raw = serverException('Invalid argument: Radius must be positive', true);
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: raw
			})
		);

		try {
			await fetchCompute('grasshopper', {}, config);
			throw new Error('should have thrown');
		} catch (e) {
			const err = e as ComputeError;
			// The context must hold what actually came over the wire — the message
			// rewrite ("<type>: <message>\n<stack>") belongs to err.message only.
			expect(err.context?.responseBody).toBe(raw);
		}
	});

	it('truncates a huge body to a bounded size with an honest marker', async () => {
		const raw = 'x'.repeat(10_000);
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				body: raw
			})
		);

		try {
			await fetchCompute('grasshopper', {}, config);
			throw new Error('should have thrown');
		} catch (e) {
			const body = (e as ComputeError).context?.responseBody as string;
			expect(body.length).toBeLessThan(5_000);
			expect(body).toMatch(/truncated 5904 chars/);
			expect(body.startsWith('xxxx')).toBe(true);
		}
	});
});

describe('Grasshopper partial-success (500 with values) still passes through', () => {
	it('returns the body instead of throwing', async () => {
		const partial = {
			values: [{ ParamName: 'out', InnerTree: {} }],
			errors: ['1. Solution exception: division by zero'],
			warnings: []
		};
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: JSON.stringify(partial)
			})
		);

		const res = await fetchCompute('grasshopper', {}, config);
		expect(res).toEqual(partial);
	});
});

describe('server error codes are caller-supplied', () => {
	/** A 502 whose body carries a machine code — status maps to NETWORK_ERROR by default. */
	const coded = () =>
		createMockResponse(null, {
			ok: false,
			status: 502,
			statusText: 'Bad Gateway',
			body: JSON.stringify({ error: 'Bad Gateway', code: 'definition_not_cached' })
		});

	it('ignores a server code the caller did not declare', async () => {
		fetchMock.mockResolvedValueOnce(coded());

		expect.assertions(1);
		try {
			await fetchCompute('solve', {}, config);
		} catch (e) {
			expect((e as ComputeError).code).toBe(ErrorCodes.NETWORK_ERROR);
		}
	});

	it('lets a declared code outrank the status-based mapping', async () => {
		fetchMock.mockResolvedValueOnce(coded());

		expect.assertions(1);
		try {
			await fetchCompute(
				'solve',
				{},
				{
					...config,
					serverErrorCodes: { definition_not_cached: ErrorCodes.DEFINITION_NOT_CACHED }
				}
			);
		} catch (e) {
			expect((e as ComputeError).code).toBe(ErrorCodes.DEFINITION_NOT_CACHED);
		}
	});
});
