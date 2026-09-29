import type { SolveEvent } from '@selvajs/schemas';

/**
 * Reads what the plugin POSTs to the callback route. The plugin is trusted to be ours but not to
 * be well-formed (an older or foreign plugin could post anything the token allows), so every
 * field is checked and anything unusable is dropped rather than refused: one bad event must not
 * cost the solve its abort channel.
 */

/** More than the plugin's own queue holds (256), so a well-behaved batch is never truncated. */
export const MAX_EVENTS_PER_POST = 256;

export type IncomingSolveEvent = Omit<SolveEvent, 'seq' | 'solveId'>;

export function readBearer(request: Request): string | null {
	const auth = request.headers.get('authorization');
	return auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
}

/**
 * The events in a callback body, in order. `seq` and `solveId` are the bus's to stamp, so any the
 * plugin sent are ignored. `now` stands in for a missing `at`.
 */
export function parseCallbackEvents(body: unknown, now: string): IncomingSolveEvent[] {
	const raw = (body as { events?: unknown } | null)?.events;
	if (!Array.isArray(raw)) return [];
	return raw.slice(0, MAX_EVENTS_PER_POST).flatMap((entry): IncomingSolveEvent[] => {
		if (!entry || typeof entry !== 'object') return [];
		const e = entry as { type?: unknown; at?: unknown; payload?: unknown };
		if (typeof e.type !== 'string' || !e.type) return [];
		const payload =
			e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload)
				? (e.payload as Record<string, unknown>)
				: undefined;
		return [
			{ type: e.type, at: typeof e.at === 'string' ? e.at : now, ...(payload ? { payload } : {}) }
		];
	});
}
