import { describe, it, expect } from 'vitest';
import { isNewer } from '../semver.js';

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
