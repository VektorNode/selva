import { getLogger } from '../utils/logger';

import {
	AFFINITY_OUTCOMES,
	type AffinityOutcome,
	type ComputeProfileEntry,
	type ServerTiming
} from '../types';

/**
 * Parse a W3C Server Timing header, as the solve endpoint emits it:
 * `decode;dur=3, solve;dur=120, gh;dur=110, encode;dur=8, recomputed;desc="4/97"`, or
 * `cache;desc="hit"` when the server answered from its result cache. A proxy's `affinity` can
 * arrive alone, with no durations. Null when it carries no recognised entry.
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
		} else if (name === 'affinity') {
			const outcome = param(params, 'desc');
			if (!isAffinity(outcome)) continue;
			timing.affinity = outcome;
			sawMetric = true;
		}
	}
	return sawMetric ? timing : null;
}

/**
 * Parse `X-Compute-Profile`, a JSON array of `{ name, nick, ms }`. Entries of another shape are
 * dropped; null when none is left or the header is not JSON.
 */
export function parseComputeProfile(headerValue: string | null): ComputeProfileEntry[] | null {
	if (!headerValue) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(headerValue);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const entries = parsed.filter(
		(e): e is ComputeProfileEntry =>
			typeof e === 'object' &&
			e !== null &&
			typeof e.name === 'string' &&
			typeof e.nick === 'string' &&
			typeof e.ms === 'number' &&
			Number.isFinite(e.ms)
	);
	return entries.length > 0 ? entries.map(({ name, nick, ms }) => ({ name, nick, ms })) : null;
}

function isAffinity(value: string | undefined): value is AffinityOutcome {
	return (AFFINITY_OUTCOMES as readonly (string | undefined)[]).includes(value);
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
	onServerTiming: ((timing: ServerTiming, requestId: string) => void) | undefined
): void {
	if (!onServerTiming) return;
	const timing = parseServerTiming(response.headers.get('Server-Timing'));
	if (!timing) return;
	const profile = parseComputeProfile(response.headers.get('X-Compute-Profile'));
	if (profile) timing.profile = profile;
	try {
		onServerTiming(timing, requestId);
	} catch (err) {
		getLogger().debug(
			`onServerTiming callback threw ${err instanceof Error ? err.name : typeof err}`
		);
	}
}
