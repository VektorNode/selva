import { getLogger } from '../utils/logger';

import type { ServerTiming } from '../types';

/**
 * Parse a W3C Server Timing header, as the solve endpoint emits it:
 * `decode;dur=3, solve;dur=120, gh;dur=110, encode;dur=8, recomputed;desc="4/97"`, or
 * `cache;desc="hit"` when the server answered from its result cache. Null when it carries no
 * recognised metric.
 */
export function parseServerTiming(headerValue: string | null): ServerTiming | null {
	if (!headerValue) return null;
	const timing: ServerTiming = { raw: headerValue };
	let sawMetric = false;
	for (const part of headerValue.split(',')) {
		const [rawName, ...params] = part.trim().split(';');
		const name = rawName.trim().toLowerCase();
		if (name === 'decode' || name === 'solve' || name === 'encode' || name === 'gh') {
			const dur = Number(param(params, 'dur'));
			if (!Number.isFinite(dur)) continue;
			timing[name] = dur;
			sawMetric = true;
		} else if (name === 'recomputed') {
			const [ran, total] = (param(params, 'desc') ?? '').split('/').map(Number);
			if (!Number.isInteger(ran) || !Number.isInteger(total)) continue;
			timing.recomputed = { ran, total };
			sawMetric = true;
		} else if (name === 'cache' && param(params, 'desc') === 'hit') {
			timing.cacheHit = true;
			sawMetric = true;
		}
	}
	return sawMetric ? timing : null;
}

function param(params: string[], key: string): string | undefined {
	for (const p of params) {
		const [k, ...v] = p.split('=');
		if (k.trim().toLowerCase() !== key) continue;
		const value = v.join('=').trim();
		return value.replace(/^"(.*)"$/, '$1');
	}
	return undefined;
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
