/**
 * Compose a caller-supplied AbortSignal with an optional timeout. Returns a
 * combined signal, or `undefined` if neither was given.
 *
 * Uses `AbortSignal.timeout` (not setTimeout) so the timer is not throttled
 * when the tab is hidden. Falls back to a manual timer for older runtimes.
 *
 * @internal exported for tests
 */
export function composeSignal(
	callerSignal: AbortSignal | undefined,
	timeoutMs: number | undefined
): { signal: AbortSignal | undefined; cleanup: () => void } {
	const noCleanup = () => {};
	const wantsTimeout = typeof timeoutMs === 'number' && timeoutMs > 0;

	if (!callerSignal && !wantsTimeout) return { signal: undefined, cleanup: noCleanup };
	if (callerSignal && !wantsTimeout) return { signal: callerSignal, cleanup: noCleanup };

	const supportsTimeout =
		typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';

	// Timeout only: nothing is registered on a caller signal, so there is nothing to clean up on
	// the modern path (the pending timer is small and self-expires at timeoutMs).
	if (!callerSignal) {
		if (supportsTimeout) return { signal: AbortSignal.timeout(timeoutMs!), cleanup: noCleanup };
		const ctrl = new AbortController();
		const id = setTimeout(() => ctrl.abort(), timeoutMs);
		return { signal: ctrl.signal, cleanup: () => clearTimeout(id) };
	}

	// Caller signal + timeout: composed manually rather than with AbortSignal.any. `any` offers no
	// way to unregister its dependent link on the caller's signal, so an app reusing one long-lived
	// signal across many solves accumulates a registration per attempt for the full timeoutMs after
	// each response (and forever on Node versions with the known AbortSignal.any leak).
	const ctrl = new AbortController();

	let timeoutSignal: AbortSignal;
	let timerId: ReturnType<typeof setTimeout> | undefined;
	if (supportsTimeout) {
		timeoutSignal = AbortSignal.timeout(timeoutMs!);
	} else {
		const timeoutCtrl = new AbortController();
		timerId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
		timeoutSignal = timeoutCtrl.signal;
	}

	const sources = [callerSignal, timeoutSignal];
	// Forward the source's reason so fetch rejects with the right error name
	// ('TimeoutError' vs 'AbortError'), matching AbortSignal.any semantics.
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
			if (timerId !== undefined) clearTimeout(timerId);
			for (const s of sources) s.removeEventListener('abort', onAbort);
		}
	};
}
