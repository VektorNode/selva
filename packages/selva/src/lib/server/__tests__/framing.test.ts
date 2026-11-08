import { describe, expect, it } from 'vitest';
import { deniesFraming } from '../framing.js';

describe('deniesFraming', () => {
	it.each([
		'/admin',
		'/admin/users',
		'/%61dmin/users',
		'/%61%64min',
		'/setup',
		'/login',
		'/oauth/x'
	])('refuses framing %s', (path) => expect(deniesFraming(path)).toBe(true));

	it.each(['/', '/app/solve/abc', '/administrator', '/%2561dmin/users'])(
		'leaves %s framable',
		(path) => expect(deniesFraming(path)).toBe(false)
	);

	it('refuses a path that does not decode', () => {
		expect(deniesFraming('/%E0%A4%A')).toBe(true);
	});
});
