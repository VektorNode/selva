import { getLogger } from '../utils/logger';

import type { ServerTiming } from '../types';

/**
 * Parse a W3C Server Timing header, as the solve endpoint emits it:
 * `decode;dur=3, solve;dur=120, encode;dur=8`. Null when it carries no recognised metric.
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
		if (debug) getLogger().debug(`   onServerTiming callback threw: ${err}`);
	}
}
