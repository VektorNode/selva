import { describe, expect, it } from 'vitest';
import { isRemembered, takeBridgeSecret } from '../bridge-secret';

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value)
	};
}

describe('takeBridgeSecret', () => {
	it('reads the secret from the URL fragment', () => {
		expect(takeBridgeSecret('abc', '#s=SECRET', memoryStorage())).toBe('SECRET');
	});

	it('remembers it for a reload or an in-app navigation, which drop the fragment', () => {
		const storage = memoryStorage();
		takeBridgeSecret('abc', '#s=SECRET', storage);

		expect(takeBridgeSecret('abc', '', storage)).toBe('SECRET');
	});

	it('keeps secrets of different sessions apart', () => {
		const storage = memoryStorage();
		takeBridgeSecret('abc', '#s=SECRET', storage);

		expect(takeBridgeSecret('other', '', storage)).toBeNull();
	});

	it('prefers a fresh fragment over a remembered secret', () => {
		const storage = memoryStorage();
		takeBridgeSecret('abc', '#s=OLD', storage);

		expect(takeBridgeSecret('abc', '#s=NEW', storage)).toBe('NEW');
		expect(takeBridgeSecret('abc', '', storage)).toBe('NEW');
	});

	it('is null when the page was not opened from Grasshopper', () => {
		expect(takeBridgeSecret('abc', '', memoryStorage())).toBeNull();
		expect(takeBridgeSecret('abc', '#s=', memoryStorage())).toBeNull();
	});

	it('still works for this load when storage is blocked', () => {
		const blocked = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('SecurityError');
			}
		};

		expect(takeBridgeSecret('abc', '#s=SECRET', blocked)).toBe('SECRET');
		expect(takeBridgeSecret('abc', '', blocked)).toBeNull();
		expect(takeBridgeSecret('abc', '#s=SECRET', null)).toBe('SECRET');
	});
});

describe('isRemembered', () => {
	it('is true once storage holds the secret, so the fragment can leave the address bar', () => {
		const storage = memoryStorage();
		takeBridgeSecret('abc', '#s=SECRET', storage);
		expect(isRemembered('abc', 'SECRET', storage)).toBe(true);
	});

	it('is false when storage is blocked: a reload still needs the fragment', () => {
		const blocked = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('SecurityError');
			}
		};
		expect(isRemembered('abc', 'SECRET', blocked)).toBe(false);
		expect(isRemembered('abc', 'SECRET', null)).toBe(false);
	});
});
