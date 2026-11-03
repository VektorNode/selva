import { describe, it, expect, vi } from 'vitest';
import { createRequestMemo } from '../request-memo.js';

describe('createRequestMemo', () => {
	it('reads a key once per GET request', async () => {
		const memo = createRequestMemo();
		const read = vi.fn(async () => 'org');
		await memo.run('GET', async () => {
			expect(await Promise.all([memo.get('k', read), memo.get('k', read)])).toEqual(['org', 'org']);
		});
		expect(read).toHaveBeenCalledTimes(1);
	});

	it('shares nothing between requests', async () => {
		const memo = createRequestMemo();
		const read = vi.fn(async () => 'org');
		await memo.run('GET', () => memo.get('k', read));
		await memo.run('GET', () => memo.get('k', read));
		expect(read).toHaveBeenCalledTimes(2);
	});

	it('keeps no memo for a write, even one made from inside a GET', async () => {
		const memo = createRequestMemo();
		const read = vi.fn(async () => 'org');
		await memo.run('POST', async () => {
			await memo.get('k', read);
			await memo.get('k', read);
		});
		await memo.run('GET', () =>
			memo.run('POST', async () => {
				await memo.get('k', read);
				await memo.get('k', read);
			})
		);
		expect(read).toHaveBeenCalledTimes(4);
	});

	it('does not keep a failed read', async () => {
		const memo = createRequestMemo();
		const read = vi.fn().mockRejectedValueOnce(new Error('away')).mockResolvedValue('org');
		await memo.run('GET', async () => {
			await expect(memo.get('k', read)).rejects.toThrow('away');
			expect(await memo.get('k', read)).toBe('org');
		});
	});
});
