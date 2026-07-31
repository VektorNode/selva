import { describe, expect, it } from 'vitest';

import { rhinoToThree } from '../../../shared/index.js';

describe('rhinoToThree (shared coordinate transform)', () => {
	it('is the identity: Rhino coords pass through to the same Three coords', () => {
		expect(rhinoToThree(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
	});

	it('is unaffected by the legacy apply flag', () => {
		expect(rhinoToThree(1, 2, 3, false)).toEqual({ x: 1, y: 2, z: 3 });
		expect(rhinoToThree(1, 2, 3, true)).toEqual({ x: 1, y: 2, z: 3 });
	});
});
