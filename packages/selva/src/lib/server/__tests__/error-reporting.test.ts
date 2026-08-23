/**
 * `handleError` reporting contract. Pins the property that matters for O1:
 * genuinely unexpected errors are shipped to the error reporter, but intentional
 * HTTP outcomes — including the compute route's `apiError(500, …)` on a failed
 * solve — are NOT, because they arrive as SvelteKit `HttpError`s and short-circuit
 * before the reporter runs. Regressing this would flood Sentry with handled
 * compute failures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';
import type { IErrorReporter, ErrorContext } from '@selvajs/platform';
import { handleError } from '../../../hooks.server.js';
import * as providersServer from '../providers.server.js';

class CapturingReporter implements IErrorReporter {
	readonly calls: Array<{ error: unknown; context?: ErrorContext }> = [];
	capture(err: unknown, context?: ErrorContext): void {
		this.calls.push({ error: err, context });
	}
}

let reporter: CapturingReporter;

beforeEach(() => {
	reporter = new CapturingReporter();
	vi.spyOn(providersServer, 'getErrorReporter').mockReturnValue(reporter);
});

function fakeEvent(
	pathname: string,
	method = 'GET',
	ctx?: { userId?: string; actingOrgId?: string }
) {
	return {
		request: { method },
		url: new URL(`http://localhost${pathname}`),
		locals: ctx ? { ctx } : {}
	} as unknown as Parameters<typeof handleError>[0]['event'];
}

describe('handleError — error reporting', () => {
	it('reports a genuinely unexpected (non-HTTP) error with route context', () => {
		const boom = new Error('kaboom');
		const result = handleError({
			error: boom,
			status: 500,
			event: fakeEvent('/api/definitions', 'POST', { userId: 'u1', actingOrgId: 'o1' }),
			message: 'Internal Error'
		});

		expect(reporter.calls).toHaveLength(1);
		expect(reporter.calls[0].error).toBe(boom);
		expect(reporter.calls[0].context).toMatchObject({
			method: 'POST',
			route: '/api/definitions',
			userId: 'u1',
			orgId: 'o1'
		});
		// Client still sees the generic, non-leaking body.
		expect(result).toMatchObject({ code: 'INTERNAL' });
	});

	it('does NOT report an intentional HTTP 500 (e.g. a failed compute solve)', () => {
		// The compute route surfaces solve failures via `apiError(500, …)`, which
		// throws exactly this shape of HttpError.
		let httpErr: unknown;
		try {
			throw error(500, { message: 'Compute solve failed', code: 'INTERNAL' });
		} catch (e) {
			httpErr = e;
		}

		handleError({
			error: httpErr,
			status: 500,
			event: fakeEvent('/api/compute', 'POST'),
			message: 'Internal Error'
		});

		expect(reporter.calls).toHaveLength(0);
	});

	it('does NOT report a 404', () => {
		handleError({
			error: new Error('not found'),
			status: 404,
			event: fakeEvent('/nope'),
			message: 'Not Found'
		});
		expect(reporter.calls).toHaveLength(0);
	});
});
