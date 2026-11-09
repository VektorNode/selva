import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('#lib/server/env.js', () => ({ env }));

import { computeSessionId, solveSessionId } from '../sessionId.server';
import type { SolveAccess } from '../solve.server';

beforeEach(() => {
	env.SELVA_HMAC_KEY = 'test-secret-that-is-at-least-32-chars-long';
});

describe('computeSessionId', () => {
	// scripts/develop/solve-bench/lib.test.mjs pins the same vector: the bench derives ids itself
	// to find each session in compute's routing log.
	it('matches the vector the solve bench pins', () => {
		expect(computeSessionId('user-1', 'def-1')).toBe('63731a4c6bfb9b752e106f6385e6c3b5');
	});

	it('is stable for one user and definition', () => {
		expect(computeSessionId('user-1', 'def-1')).toBe(computeSessionId('user-1', 'def-1'));
	});

	it('differs by user and by definition', () => {
		const id = computeSessionId('user-1', 'def-1');
		expect(computeSessionId('user-2', 'def-1')).not.toBe(id);
		expect(computeSessionId('user-1', 'def-2')).not.toBe(id);
	});

	it('cannot be forged by moving the separator between user and definition', () => {
		expect(computeSessionId('a', 'bc')).not.toBe(computeSessionId('ab', 'c'));
	});

	it('fits the header compute accepts and does not contain the user id', () => {
		const id = computeSessionId('user-1', 'def-1');
		expect(id).toMatch(/^[0-9a-f]{32}$/);
		expect(id).not.toContain('user-1');
	});

	it('changes with the key', () => {
		const before = computeSessionId('user-1', 'def-1');
		env.SELVA_HMAC_KEY = 'another-secret-that-is-at-least-32-chars';
		expect(computeSessionId('user-1', 'def-1')).not.toBe(before);
	});

	it('is undefined without a key, so the solve goes out without a header', () => {
		env.SELVA_HMAC_KEY = undefined;
		expect(computeSessionId('user-1', 'def-1')).toBeUndefined();
	});
});

describe('solveSessionId', () => {
	const access = (kind: 'user' | 'share', userId: string | null) =>
		({ kind, ctx: { userId }, rateLimitKey: 'k' }) as unknown as SolveAccess;

	it("gives a signed-in user's solve of a stored definition its session", () => {
		expect(solveSessionId(access('user', 'user-1'), 'def-1')).toBe(
			computeSessionId('user-1', 'def-1')
		);
	});

	it('gives none to a share link, a remote URL, or a caller without a user id', () => {
		expect(solveSessionId(access('share', 'user-1'), 'def-1')).toBeUndefined();
		expect(solveSessionId(access('user', 'user-1'), null)).toBeUndefined();
		expect(solveSessionId(access('user', null), 'def-1')).toBeUndefined();
	});
});
