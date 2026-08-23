import { describe, it, expect } from 'vitest';
import {
	resolveRequestId,
	sanitizeRequestId,
	renderThrown,
	REQUEST_ID_HEADER
} from '../requestId.js';

const headersWith = (id: string): Headers => new Headers({ [REQUEST_ID_HEADER]: id });

describe('sanitizeRequestId', () => {
	it('passes through the id shapes real proxies emit', () => {
		// In order: UUID (nginx $request_id / Caddy), W3C hex trace-id, ULID.
		for (const id of [
			'3f6b1c4e-9a2d-4f7b-8c1e-2a5d6f0b9c3a',
			'4bf92f3577b34da6a3ce929d0e0e4736',
			'01ARZ3NDEKTSV4RRFFQ69G5FAV'
		]) {
			expect(sanitizeRequestId(id)).toBe(id);
		}
	});

	it('strips CR/LF so a caller cannot forge extra log lines', () => {
		// The payload is shaped to terminate the record and open a second,
		// attacker-authored one — hence the space check too, not just CR/LF.
		const forged = 'abc\r\nlevel=error msg="disk failure"';
		const cleaned = sanitizeRequestId(forged);
		expect(cleaned).not.toContain('\n');
		expect(cleaned).not.toContain('\r');
		expect(cleaned).not.toContain(' ');
	});

	it('truncates an overlong id so one caller cannot bloat every record', () => {
		expect(sanitizeRequestId('a'.repeat(5000))).toHaveLength(128);
	});

	it('returns null when nothing usable survives, so the caller generates', () => {
		expect(sanitizeRequestId('!!!  @@@')).toBeNull();
		expect(sanitizeRequestId('')).toBeNull();
		expect(sanitizeRequestId(undefined)).toBeNull();
		expect(sanitizeRequestId(null)).toBeNull();
	});
});

describe('resolveRequestId', () => {
	it("reuses the proxy's id so logs correlate across tiers", () => {
		const id = '3f6b1c4e-9a2d-4f7b-8c1e-2a5d6f0b9c3a';
		expect(resolveRequestId(headersWith(id), () => 'generated')).toBe(id);
	});

	it('generates when no header is present', () => {
		expect(resolveRequestId(new Headers(), () => 'generated')).toBe('generated');
	});

	it('generates rather than propagating an unusable header', () => {
		expect(resolveRequestId(headersWith('///'), () => 'generated')).toBe('generated');
	});

	it('generates a unique id per call by default', () => {
		const a = resolveRequestId(new Headers());
		const b = resolveRequestId(new Headers());
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThan(0);
	});
});

describe('renderThrown', () => {
	it('keeps the stack for Errors — that is the diagnostic', () => {
		const rendered = renderThrown(new Error('boom'));
		expect(rendered).toContain('boom');
		// Matching this file's name proves the stack survived, not just the message.
		expect(rendered).toContain('requestId.test.ts');
	});

	it('falls back to the message when an Error carries no stack', () => {
		const stackless = new Error('no stack here');
		stackless.stack = undefined;
		expect(renderThrown(stackless)).toBe('no stack here');
	});

	it('serializes non-Error rejections instead of "[object Object]"', () => {
		// Provider adapters reject with plain objects; String() would destroy the
		// only record of what failed.
		expect(renderThrown({ message: 'nope', status: 503 })).toBe('{"message":"nope","status":503}');
	});

	it('survives a circular value', () => {
		const cyclic: Record<string, unknown> = { a: 1 };
		cyclic.self = cyclic;
		expect(() => renderThrown(cyclic)).not.toThrow();
	});

	it('renders undefined without collapsing to empty', () => {
		expect(renderThrown(undefined)).toBe('undefined');
	});
});
