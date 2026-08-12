/**
 * Channel-aware semver comparison for update checks. Understands exactly the
 * two lines Selva publishes under: stable (`x.y.z`, npm `latest`) and beta
 * (`x.y.z-beta.N`, npm `beta`). Deliberately not general semver — no build
 * metadata, no arbitrary pre-release identifiers.
 */

/** Which published line a deployment tracks. */
export type ReleaseChannel = 'stable' | 'beta';

/**
 * Parse `x.y.z` plus an optional `-beta.N` counter. `beta` comes back separate
 * from the core so beta-channel comparisons can order successive betas of one
 * core. Null when the string doesn't lead with a numeric core.
 */
export function parseSemver(
	v: string
): { core: [number, number, number]; beta: number | null } | null {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(v.trim());
	if (!m) return null;
	return {
		core: [Number(m[1]), Number(m[2]), Number(m[3])],
		beta: m[4] != null ? Number(m[4]) : null
	};
}

/**
 * Compare two `x.y.z` cores, ignoring pre-release tails. Callers that care
 * about those want `isNewer`, which layers the channel rules on top.
 */
export function compareCore(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return 0;
	for (let i = 0; i < 3; i++) {
		if (pa.core[i] > pb.core[i]) return 1;
		if (pa.core[i] < pb.core[i]) return -1;
	}
	return 0;
}

/**
 * Does `version` satisfy an `engines.node` range?
 *
 * Deliberately narrow: handles the `>=`, `>`, `<=`, `<`, `^`, `~`, `=` and
 * bare-version forms Selva and its dependencies publish, plus `||` alternatives
 * and space-separated conjunctions (`>=18 <21`). Anything it can't parse
 * returns `null` for "unknown", never a false "incompatible" — a wrong block
 * would strand an operator with no way to override the bad parse.
 *
 * A full `semver` dependency would subsume this, but isn't warranted for the
 * handful of range forms in play.
 */
export function satisfiesRange(version: string, range: string): boolean | null {
	const v = parseSemver(version);
	if (!v) return null;

	const alternatives = range.split('||').map((r) => r.trim());
	let anyParsed = false;

	for (const alt of alternatives) {
		const clauses = alt.split(/\s+/).filter(Boolean);
		if (clauses.length === 0) continue;

		let all = true;
		let altParsed = true;
		for (const clause of clauses) {
			const m = /^(>=|<=|>|<|\^|~|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(clause);
			if (!m) {
				altParsed = false;
				break;
			}
			const op = m[1] ?? '=';
			const num = (s: string | undefined) => (s == null || s === 'x' || s === '*' ? 0 : Number(s));
			const target: [number, number, number] = [Number(m[2]), num(m[3]), num(m[4])];
			const cmp = (() => {
				for (let i = 0; i < 3; i++) {
					if (v.core[i] > target[i]) return 1;
					if (v.core[i] < target[i]) return -1;
				}
				return 0;
			})();

			let ok: boolean;
			switch (op) {
				case '>=':
					ok = cmp >= 0;
					break;
				case '>':
					ok = cmp > 0;
					break;
				case '<=':
					ok = cmp <= 0;
					break;
				case '<':
					ok = cmp < 0;
					break;
				// ^X.Y.Z allows anything up to the next major; ~X.Y.Z up to the next minor.
				case '^':
					ok = cmp >= 0 && v.core[0] === target[0];
					break;
				case '~':
					ok = cmp >= 0 && v.core[0] === target[0] && v.core[1] === target[1];
					break;
				default:
					// A bare version means that exact release, but `18` / `18.x` mean the
					// whole line — treat omitted segments as wildcards.
					ok =
						v.core[0] === target[0] &&
						(m[3] == null || m[3] === 'x' || m[3] === '*' || v.core[1] === target[1]) &&
						(m[4] == null || m[4] === 'x' || m[4] === '*' || v.core[2] === target[2]);
			}
			if (!ok) {
				all = false;
				break;
			}
		}
		if (!altParsed) continue;
		anyParsed = true;
		if (all) return true;
	}

	return anyParsed ? false : null;
}

/**
 * True when `latest` is strictly newer than `current`.
 *
 * Stable channel (default): pre-release suffixes are ignored, so only stable
 * core bumps surface.
 *
 * Beta channel: pre-releases participate. A higher core wins; on an equal core
 * a higher `-beta.N` wins, and a stable (no suffix) outranks any -beta of that
 * core (4.6.0 > 4.6.0-beta.9). An update UI can then show both "beta.1 →
 * beta.2" and the promotion of a beta line to stable.
 *
 * Unparseable versions fall back to inequality: different strings count as
 * newer, so an odd published version still surfaces; identical ones don't.
 */
export function isNewer(
	latest: string,
	current: string,
	channel: ReleaseChannel = 'stable'
): boolean {
	const a = parseSemver(latest);
	const b = parseSemver(current);
	if (!a || !b) return latest !== current;
	for (let i = 0; i < 3; i++) {
		if (a.core[i] > b.core[i]) return true;
		if (a.core[i] < b.core[i]) return false;
	}
	if (channel !== 'beta') return false;
	// Stable (beta == null) ranks above any pre-release of the same core.
	const rank = (beta: number | null) => (beta == null ? Infinity : beta);
	return rank(a.beta) > rank(b.beta);
}
