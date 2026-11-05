/**
 * Reads repeated inside one request, shared: a layout and its page both asking for the same
 * thing pay one round trip. Only GET and HEAD get a memo: an action writes, and the page load
 * that runs after it in the same request must read what it wrote.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestMemo {
	/** Runs `fn` with a fresh memo for a GET or HEAD; any other method runs with none, even nested. */
	run<T>(method: string, fn: () => T): T;
	/**
	 * `read()` once per key in the current request; with no memo open it just runs. The key must
	 * name everything the result depends on (the caller, the org, the id). A rejection is not kept.
	 */
	get<T>(key: string, read: () => Promise<T>): Promise<T>;
}

export function createRequestMemo(): RequestMemo {
	const als = new AsyncLocalStorage<Map<string, Promise<unknown>>>();
	return {
		run(method, fn) {
			return method === 'GET' || method === 'HEAD' ? als.run(new Map(), fn) : als.exit(fn);
		},
		get<T>(key: string, read: () => Promise<T>): Promise<T> {
			const memo = als.getStore();
			if (!memo) return read();
			const hit = memo.get(key);
			if (hit) return hit as Promise<T>;
			const pending = read();
			memo.set(key, pending);
			pending.catch(() => memo.delete(key));
			return pending;
		}
	};
}
