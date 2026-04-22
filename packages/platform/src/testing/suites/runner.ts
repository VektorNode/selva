import type { RequestContext } from '../../context.js';

export interface ConformanceExpect<T> {
	toBe: (expected: T) => void;
	toEqual: (expected: unknown) => void;
	toBeNull: () => void;
	toBeTruthy: () => void;
	toBeFalsy: () => void;
	toContain: (expected: unknown) => void;
	toBeLessThanOrEqual: (expected: number) => void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	toThrow: (expected?: any) => void;
	resolves: ConformanceExpect<Awaited<T>>;
	not: ConformanceExpect<T>;
}

export interface ConformanceRunner {
	describe: (name: string, fn: () => void) => void;
	it: (name: string, fn: () => Promise<void> | void) => void;
	expect: <T>(actual: T) => ConformanceExpect<T>;
}

export function makeCtx(
	userId: string,
	permissions: RequestContext['permissions'] = ['platform_admin']
): RequestContext {
	return { userId, permissions };
}

export function makeUuid(): string {
	return crypto.randomUUID();
}
