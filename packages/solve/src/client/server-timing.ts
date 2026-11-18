/** A `Server-Timing` header's `dur` entries, in ms by metric name. */
export function parseServerTiming(header: string | null): Record<string, number> {
	const out: Record<string, number> = {};
	if (!header) return out;
	for (const part of header.split(',')) {
		const [name, ...params] = part.split(';').map((s) => s.trim());
		const dur = params.find((p) => p.startsWith('dur='));
		if (!name || !dur) continue;
		const ms = Number(dur.slice(4));
		if (Number.isFinite(ms)) out[name] = ms;
	}
	return out;
}

/**
 * Where the server's time went, as one line for the debug log. Null without a `solve` entry.
 *
 * `compute` is the whole call to Rhino.Compute. A server that reports its own timing splits it
 * into `solve` (of which `grasshopper` is the definition running), `decode`, `encode`, and
 * `queue+link`: the rest, network plus the wait for a free worker. `prep` is what the app did
 * before the solve, slowest step first, steps under 1 ms left out.
 */
export function describeServerTiming(header: string | null): string | null {
	const t = parseServerTiming(header);
	if (!header || t.solve === undefined) return null;
	const ms = (value: number | undefined) => (value ?? 0).toFixed(0);

	let compute = `compute ${ms(t.solve)}`;
	if (t.rhino_solve !== undefined) {
		const grasshopper = t.rhino_gh === undefined ? '' : ` (grasshopper ${ms(t.rhino_gh)})`;
		compute +=
			`: solve ${ms(t.rhino_solve)}${grasshopper}, decode ${ms(t.rhino_decode)}, ` +
			`encode ${ms(t.rhino_encode)}, queue+link ${ms(t.compute_link)}`;
	}
	const parts = [compute];

	const prep = Object.entries(t).filter(([name]) => name.startsWith('p_'));
	const prepTotal = prep.reduce((sum, [, dur]) => sum + dur, 0);
	if (prepTotal >= 1) {
		const steps = prep
			.filter(([, dur]) => dur >= 1)
			.sort((a, b) => b[1] - a[1])
			.map(([name, dur]) => `${name.slice(2)} ${ms(dur)}`);
		parts.push(`prep ${ms(prepTotal)}: ${steps.join(', ')}`);
	}

	parts.push(`tree ${ms(t.tree)}`, `serialize ${ms(t.serialize)}`, `gzip ${ms(t.gzip)}`);
	if (t.def_reupload) parts.push('definition re-sent to Compute');
	for (const [, name, value] of header.matchAll(/(\w+);desc="?([^",;]+)"?/g)) {
		parts.push(`${name.replace(/^rhino_/, '')} ${value}`);
	}
	return parts.join(' | ');
}
