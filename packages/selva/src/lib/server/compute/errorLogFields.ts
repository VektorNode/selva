import { ComputeError } from '@selvajs/compute/core';

/**
 * Log fields for a failed solve. Compute's raw error body can quote what was solved, and erasure
 * can't reach a log line, so it goes out only when an operator asked for raw bodies. The request id
 * ties the line to the server's own logs.
 */
export function computeErrorLogFields(
	err: unknown,
	includeBody: boolean
): Record<string, string | number> {
	if (!(err instanceof ComputeError)) return {};
	const { requestId, responseBody } = err.context ?? {};
	return {
		...(typeof requestId === 'string' && { computeRequestId: requestId }),
		...(typeof responseBody === 'string' && {
			computeBodyChars: responseBody.length,
			...(includeBody && { computeResponseBody: responseBody })
		})
	};
}
