/**
 * Audit Q5.4 — direct tests for the session-token HMAC.
 *
 * `hmac.ts` is the local provider's entire session-auth mechanism: whoever can
 * forge a token here is any user they name. Until now it was covered only
 * indirectly, by three cases in the auth conformance suite (round-trip, garbage
 * string, empty string) — none of which exercise a *hostile* token. Every test
 * below is an attack the verifier must refuse, plus the boundary conditions
 * (`lastIndexOf` parsing, the `timingSafeEqual` length guard) that an innocent
 * refactor could silently break.
 *
 * The bar: `verifyHmacToken` must return `{ valid: false }` — never throw, and
 * never return a userId — for every input that isn't a token this secret signed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { signHmacToken, verifyHmacToken } from '../hmac.js';

/** Sign a hand-built payload the way `signHmacToken` would, to forge test inputs. */
const signPayload = (payload: string): string =>
	createHmac('sha256', SECRET).update(payload).digest('base64url');

const SECRET = 'test-hmac-secret-32-chars-minimum-length';
const OTHER_SECRET = 'a-completely-different-secret-value-here';

afterEach(() => vi.useRealTimers());

describe('signHmacToken / verifyHmacToken — happy path', () => {
	it('round-trips a userId', () => {
		const token = signHmacToken(SECRET, 'user-123');
		expect(verifyHmacToken(token, SECRET)).toEqual({ userId: 'user-123', valid: true });
	});

	it('produces the documented payload.signature shape', () => {
		const token = signHmacToken(SECRET, 'user-123');
		const parts = token.split('.');
		expect(parts).toHaveLength(2);
		// Payload is base64url — never the raw userId on the wire.
		expect(token).not.toContain('user-123');
		expect(Buffer.from(parts[0], 'base64url').toString()).toMatch(/^user-123:\d+$/);
	});

	it('round-trips a userId containing a colon', () => {
		// Parsing splits on the LAST colon (`decoded.lastIndexOf(':')`), so a
		// colon inside the userId must not truncate it — an email-shaped or
		// namespaced id (`ns:user`) has to survive intact or it would verify as
		// a DIFFERENT user.
		const token = signHmacToken(SECRET, 'tenant:user-123');
		expect(verifyHmacToken(token, SECRET)).toEqual({ userId: 'tenant:user-123', valid: true });
	});

	it('round-trips a userId containing a dot', () => {
		// The signature split is also `lastIndexOf('.')`, and base64url never
		// emits '.', so a dotted userId is safe — pinned because switching to
		// `split('.')` or `indexOf` would break exactly this case.
		const token = signHmacToken(SECRET, 'first.last@example.com');
		expect(verifyHmacToken(token, SECRET)).toEqual({
			userId: 'first.last@example.com',
			valid: true
		});
	});
});

describe('verifyHmacToken — forged and tampered tokens are refused', () => {
	it('refuses a token signed with a different secret', () => {
		// The core property: possession of a well-formed token is worthless
		// without the signing key.
		const token = signHmacToken(OTHER_SECRET, 'user-123');
		expect(verifyHmacToken(token, SECRET)).toEqual({ userId: '', valid: false });
	});

	it('refuses a tampered payload (privilege escalation attempt)', () => {
		// Attacker re-encodes the payload as another user, keeping the signature.
		const token = signHmacToken(SECRET, 'user-123');
		const sig = token.slice(token.lastIndexOf('.') + 1);
		const forgedPayload = Buffer.from(`admin:${Date.now() + 60_000}`).toString('base64url');

		expect(verifyHmacToken(`${forgedPayload}.${sig}`, SECRET)).toEqual({
			userId: '',
			valid: false
		});
	});

	it('refuses a tampered signature', () => {
		const token = signHmacToken(SECRET, 'user-123');
		const dot = token.lastIndexOf('.');
		const payload = token.slice(0, dot);
		const sig = token.slice(dot + 1);
		// Flip the first character to something else of the same length — this
		// keeps the length guard satisfied so `timingSafeEqual` is what rejects.
		const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);

		expect(verifyHmacToken(`${payload}.${flipped}`, SECRET)).toEqual({ userId: '', valid: false });
	});

	it('refuses an extended-expiry replay (payload rewritten to expire later)', () => {
		// The expiry lives INSIDE the signed payload, so pushing it out must
		// invalidate the signature rather than extend the session.
		const token = signHmacToken(SECRET, 'user-123');
		const sig = token.slice(token.lastIndexOf('.') + 1);
		const farFuture = Buffer.from(`user-123:${Date.now() + 10 ** 10}`).toString('base64url');

		expect(verifyHmacToken(`${farFuture}.${sig}`, SECRET)).toEqual({ userId: '', valid: false });
	});

	it('refuses a signature of the wrong length without throwing', () => {
		// `timingSafeEqual` THROWS on length mismatch — the explicit length guard
		// before it is load-bearing. A truncated signature must be a clean
		// refusal, not a 500.
		const token = signHmacToken(SECRET, 'user-123');
		const dot = token.lastIndexOf('.');
		const payload = token.slice(0, dot);

		expect(() => verifyHmacToken(`${payload}.short`, SECRET)).not.toThrow();
		expect(verifyHmacToken(`${payload}.short`, SECRET)).toEqual({ userId: '', valid: false });
		// Longer than expected, too.
		expect(verifyHmacToken(`${payload}.${'x'.repeat(200)}`, SECRET)).toEqual({
			userId: '',
			valid: false
		});
	});
});

describe('verifyHmacToken — expiry', () => {
	it('refuses an expired token', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const token = signHmacToken(SECRET, 'user-123', 60_000); // 1 minute

		// Still valid inside the window.
		vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
		expect(verifyHmacToken(token, SECRET).valid).toBe(true);

		// Dead once past it.
		vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
		expect(verifyHmacToken(token, SECRET)).toEqual({ userId: '', valid: false });
	});

	it('treats the exact expiry instant as expired (>= boundary)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const token = signHmacToken(SECRET, 'user-123', 60_000);

		vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
		expect(verifyHmacToken(token, SECRET).valid).toBe(false);
	});

	it('refuses a token minted already-expired (negative maxAge)', () => {
		expect(verifyHmacToken(signHmacToken(SECRET, 'user-123', -1000), SECRET)).toEqual({
			userId: '',
			valid: false
		});
	});

	it('refuses a non-numeric expiry rather than admitting it', () => {
		// Hand-built payload whose expiry won't parse. `parseInt('abc')` is NaN,
		// and the guard must reject it — a NaN comparison is false, so without
		// the explicit `Number.isFinite` check this would sail through.
		const payload = Buffer.from('user-123:abc').toString('base64url');

		expect(verifyHmacToken(`${payload}.${signPayload(payload)}`, SECRET)).toEqual({
			userId: '',
			valid: false
		});
	});
});

describe('verifyHmacToken — malformed input never throws', () => {
	it.each([
		['empty string', ''],
		['garbage', 'not-a-token'],
		['no dot separator', 'abcdef'],
		['dot only', '.'],
		['empty payload', '.somesig'],
		['empty signature', 'somepayload.'],
		['payload with no colon', `${Buffer.from('nocolonhere').toString('base64url')}.sig`],
		['non-base64url payload', '!!!not-base64!!!.sig']
	])('refuses %s', (_label, token) => {
		expect(() => verifyHmacToken(token, SECRET)).not.toThrow();
		expect(verifyHmacToken(token, SECRET).valid).toBe(false);
	});
});
