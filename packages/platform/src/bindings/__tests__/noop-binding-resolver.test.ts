import { describe, expect, it } from 'vitest';
import { NoopBindingResolver } from '../interface.js';

describe('NoopBindingResolver', () => {
	it('resolves nothing, so every bound input reads as missing', async () => {
		const resolved = await new NoopBindingResolver().resolve();
		expect(resolved.size).toBe(0);
	});
});
