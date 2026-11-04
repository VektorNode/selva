import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../errors.js';

describe('ProviderError across installed copies', () => {
	it('is recognised from a second copy of the module', async () => {
		vi.resetModules();
		const other = await import('../errors.js');
		expect(other.ProviderError).not.toBe(ProviderError);

		const err = new other.ProviderError('nope', 403);

		expect(err instanceof ProviderError).toBe(true);
		expect((err as ProviderError).statusCode).toBe(403);
	});

	it('does not match a plain error', () => {
		expect(new Error('x') instanceof ProviderError).toBe(false);
		expect((null as unknown) instanceof ProviderError).toBe(false);
	});

	it('leaves instanceof working for a subclass', () => {
		class Narrow extends ProviderError {}
		expect(new Narrow('x') instanceof Narrow).toBe(true);
		expect(new ProviderError('x') instanceof Narrow).toBe(false);
	});
});
