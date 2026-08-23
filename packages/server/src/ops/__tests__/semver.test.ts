import { describe, it, expect } from 'vitest';
import { isNewer, satisfiesRange } from '../semver.js';

describe('isNewer', () => {
	it('detects a newer patch / minor / major', () => {
		expect(isNewer('4.3.2', '4.3.1')).toBe(true);
		expect(isNewer('4.4.0', '4.3.9')).toBe(true);
		expect(isNewer('5.0.0', '4.9.9')).toBe(true);
	});

	it('returns false for same or older versions', () => {
		expect(isNewer('4.3.1', '4.3.1')).toBe(false);
		expect(isNewer('4.3.0', '4.3.1')).toBe(false);
		expect(isNewer('3.9.9', '4.0.0')).toBe(false);
	});

	it('ignores pre-release suffixes on the stable channel (only stable bumps surface)', () => {
		expect(isNewer('4.3.2-beta.1', '4.3.1')).toBe(true);
		expect(isNewer('4.3.1-beta.1', '4.3.1')).toBe(false);
		// Explicit stable channel matches the default.
		expect(isNewer('4.3.1-beta.1', '4.3.1', 'stable')).toBe(false);
	});

	it('orders pre-releases on the beta channel', () => {
		// Successive betas of the same core.
		expect(isNewer('4.6.0-beta.2', '4.6.0-beta.1', 'beta')).toBe(true);
		expect(isNewer('4.6.0-beta.1', '4.6.0-beta.2', 'beta')).toBe(false);
		// A newer core beta beats an older stable.
		expect(isNewer('4.6.0-beta.1', '4.5.1', 'beta')).toBe(true);
		// Stable of a core outranks any beta of the same core (promotion).
		expect(isNewer('4.6.0', '4.6.0-beta.9', 'beta')).toBe(true);
		expect(isNewer('4.6.0-beta.9', '4.6.0', 'beta')).toBe(false);
		// Reverting to an OLDER stable is NOT "newer" — the channel switch, not
		// isNewer, is what makes it actionable.
		expect(isNewer('4.5.1', '4.6.0-beta.2', 'beta')).toBe(false);
	});

	it('falls back to a string compare when unparseable', () => {
		expect(isNewer('weird', 'weird')).toBe(false);
		expect(isNewer('a', 'b')).toBe(true);
	});
});

// ============================================================================
// engines.node range satisfaction
// ============================================================================

describe('satisfiesRange', () => {
	it('handles the >=X form we actually publish', () => {
		expect(satisfiesRange('22.1.0', '>=22.0.0')).toBe(true);
		expect(satisfiesRange('24.16.0', '>=22.0.0')).toBe(true);
		// The shipped incident: a Node 20 host offered a release requiring >=22.
		expect(satisfiesRange('20.20.2', '>=22.0.0')).toBe(false);
	});

	it('is exact at the boundary', () => {
		expect(satisfiesRange('22.0.0', '>=22.0.0')).toBe(true);
		expect(satisfiesRange('21.9.9', '>=22.0.0')).toBe(false);
		expect(satisfiesRange('22.0.0', '>22.0.0')).toBe(false);
	});

	it('handles caret and tilde', () => {
		expect(satisfiesRange('22.5.0', '^22.0.0')).toBe(true);
		expect(satisfiesRange('23.0.0', '^22.0.0')).toBe(false);
		expect(satisfiesRange('22.1.5', '~22.1.0')).toBe(true);
		expect(satisfiesRange('22.2.0', '~22.1.0')).toBe(false);
	});

	it('handles || alternatives and space-separated conjunctions', () => {
		expect(satisfiesRange('20.0.0', '^18.0.0 || ^20.0.0')).toBe(true);
		expect(satisfiesRange('19.0.0', '^18.0.0 || ^20.0.0')).toBe(false);
		expect(satisfiesRange('20.0.0', '>=18 <21')).toBe(true);
		expect(satisfiesRange('21.0.0', '>=18 <21')).toBe(false);
	});

	it('treats a bare major or x-range as the whole line', () => {
		expect(satisfiesRange('22.7.1', '22')).toBe(true);
		expect(satisfiesRange('22.7.1', '22.x')).toBe(true);
		expect(satisfiesRange('23.0.0', '22.x')).toBe(false);
	});

	it('returns null — never a false block — when it cannot parse', () => {
		// A wrong `false` strands an operator behind an update check that misfired.
		expect(satisfiesRange('22.0.0', 'not-a-range')).toBeNull();
		expect(satisfiesRange('not-a-version', '>=22.0.0')).toBeNull();
		expect(satisfiesRange('22.0.0', '')).toBeNull();
	});

	it('ignores a pre-release tail on the running version', () => {
		expect(satisfiesRange('22.0.0-nightly', '>=22.0.0')).toBe(true);
	});
});
