/**
 * Channel-aware semver comparison for update checks. Understands exactly the
 * two-channel model Selva-engine deployments publish under: a stable line
 * (`x.y.z`, npm `latest`) and a beta line (`x.y.z-beta.N`, npm `beta`).
 * Deliberately not a general semver implementation — no build metadata, no
 * arbitrary pre-release identifiers.
 */

/** Which published line a deployment tracks. */
export type ReleaseChannel = 'stable' | 'beta';

/**
 * Parse `x.y.z` plus an optional `-beta.N` pre-release counter. The
 * pre-release number is returned separately so beta-channel comparisons can
 * order successive betas of the same x.y.z core. Returns null for anything
 * that doesn't lead with a numeric core.
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
 * True when `latest` is strictly newer than `current` by semver.
 *
 * Stable channel (default): pre-release suffixes are ignored — only stable
 * core bumps surface.
 *
 * Beta channel: pre-releases participate. A higher core wins; on an equal
 * core, a higher `-beta.N` wins, and a stable (no suffix) outranks any -beta
 * of the same core (4.6.0 > 4.6.0-beta.9). This lets an update UI show
 * "beta.1 → beta.2" and "beta → stable promotion of the same line".
 *
 * Unparseable versions fall back to inequality: different strings count as
 * "newer" so a weird published version still surfaces, identical ones don't.
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
	// Equal core. On the stable channel we don't compare pre-release tails.
	if (channel !== 'beta') return false;
	// Stable (beta == null) ranks above any pre-release of the same core.
	const rank = (beta: number | null) => (beta == null ? Infinity : beta);
	return rank(a.beta) > rank(b.beta);
}
