import { describe, it, expect } from 'vitest';
import { displayNameIsEmail, emailSubtitle, primaryLabel } from '../user-display';

describe('user-display', () => {
	it('collapses the pair when a header-auth proxy sends email as both claims', () => {
		const u = { displayName: 'x@y.com', email: 'x@y.com' };
		expect(displayNameIsEmail(u)).toBe(true);
		expect(emailSubtitle(u)).toBeUndefined();
		expect(primaryLabel(u, 'id-1')).toBe('x@y.com');
	});

	it('collapses when the two differ only in case', () => {
		// The allowlist case-folds the UPN it materializes `email` from but leaves
		// the forwarded display name as-is, so this is the common shape, not an edge.
		const u = { displayName: 'X@Y.com', email: 'x@y.com' };
		expect(displayNameIsEmail(u)).toBe(true);
		expect(emailSubtitle(u)).toBeUndefined();
	});

	it('keeps both when the display name is a real name', () => {
		const u = { displayName: 'Ada Lovelace', email: 'ada@y.com' };
		expect(displayNameIsEmail(u)).toBe(false);
		expect(emailSubtitle(u)).toBe('ada@y.com');
		expect(primaryLabel(u, 'id-1')).toBe('Ada Lovelace');
	});

	it('falls back to email then id when there is no display name', () => {
		expect(primaryLabel({ email: 'a@b.com' }, 'id-1')).toBe('a@b.com');
		expect(primaryLabel({}, 'id-1')).toBe('id-1');
		expect(emailSubtitle({ email: 'a@b.com' })).toBeUndefined();
	});

	it('uses the display name when there is no email', () => {
		expect(primaryLabel({ displayName: 'Ada' }, 'id-1')).toBe('Ada');
		expect(displayNameIsEmail({ displayName: 'Ada' })).toBe(false);
	});
});
