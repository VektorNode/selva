/** What fetch, or a body read, rejects with when its signal fires: a caller abort or a timeout. */
export function isAbortError(error: unknown): error is Error {
	return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Compose a caller-supplied AbortSignal with an optional timeout; `undefined` when neither was
 * given. `AbortSignal.timeout` rather than `setTimeout`: its timer isn't throttled in a hidden tab.
 */
export function composeSignal(
	callerSignal: AbortSignal | undefined,
	timeoutMs: number | undefined
): { signal: AbortSignal | undefined; cleanup: () => void } {
	const noCleanup = () => {};
	if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
		return { signal: callerSignal, cleanup: noCleanup };
	}

	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	if (!callerSignal) return { signal: timeoutSignal, cleanup: noCleanup };

	// Not AbortSignal.any: it can't unregister its link on the caller's signal, so a long-lived
	// signal reused across solves would collect one registration per attempt.
	const ctrl = new AbortController();
	const sources = [callerSignal, timeoutSignal];
	// Forwarding the reason keeps fetch's rejection name ('TimeoutError' vs 'AbortError').
	const onAbort = function (this: AbortSignal) {
		ctrl.abort(this.reason);
	};

	for (const s of sources) {
		if (s.aborted) {
			ctrl.abort(s.reason);
			break;
		}
		s.addEventListener('abort', onAbort, { once: true });
	}

	return {
		signal: ctrl.signal,
		cleanup: () => {
			for (const s of sources) s.removeEventListener('abort', onAbort);
		}
	};
}
