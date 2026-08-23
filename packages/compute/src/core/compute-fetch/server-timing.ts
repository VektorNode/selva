import { log } from './log';

import type { ServerTiming } from '../types';

/**
 * Parse a `Server-Timing` header value into typed durations (ms).
 *
 * Header grammar (RFC 9110 §10.1.10), as emitted by the solve endpoint:
 *   `decode;dur=3, solve;dur=120, encode;dur=8`
 *
 * Returns null when the header is absent or carries no recognizable metric, so
 * the caller can skip the callback entirely.
 *
 * @internal exported for tests
 */
export function parseServerTiming(headerValue: string | null): ServerTiming | null {
	if (!headerValue) return null;
	const timing: ServerTiming = { raw: headerValue };
	let sawMetric = false;
	for (const part of headerValue.split(',')) {
		const [name, ...params] = part.trim().split(';');
		const durParam = params.find((p) => p.trim().toLowerCase().startsWith('dur'));
		if (!durParam) continue;
		const dur = Number(durParam.split('=')[1]);
		if (!Number.isFinite(dur)) continue;
		const key = name.trim().toLowerCase();
		if (key === 'decode' || key === 'solve' || key === 'encode') {
			timing[key] = dur;
			sawMetric = true;
		}
	}
	return sawMetric ? timing : null;
}

/**
 * Surface the server's per-request timing breakdown (if it sent one and a
 * caller is listening). Best-effort: a throwing callback must not fail the
 * request. Called on the success path AND the 500-with-values partial-success
 * path — solves that completed with Grasshopper errors carry real timings too.
 */
export function fireServerTiming(
	response: Response,
	requestId: string,
	onServerTiming: ((timing: ServerTiming, requestId: string) => void) | undefined,
	debug?: boolean
): void {
	if (!onServerTiming) return;
	const timing = parseServerTiming(response.headers.get('Server-Timing'));
	if (!timing) return;
	try {
		onServerTiming(timing, requestId);
	} catch (err) {
		if (debug) log(`   onServerTiming callback threw: ${err}`, true);
	}
}
