/**
 * SEL-2. Two things had to be true and neither was:
 *
 *   - Distinct client addresses must not share a bucket. Behind a proxy with no
 *     `ADDRESS_HEADER`, `getClientAddress()` returns `127.0.0.1` for everyone,
 *     which collapsed the key space to one bucket — five failed logins from
 *     anywhere locked out the whole instance. The env fix restores real keys;
 *     this pins that the limiter itself keys per address.
 *   - A targeted account must have its own counter. Address-only limiting bounds
 *     nothing for an attacker spread across source IPs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, recordFailedAttempt, clearRateLimit } from '../admin-auth.server.js';

const MAX_PER_ADDRESS = 5;

// The limiters are module-level and shared across tests, so every case works on
// keys it invents itself rather than trying to reset them.
let n = 0;
const freshAddress = () => `203.0.113.${++n % 250}-${n}`;
const freshEmail = () => `user${++n}@example.test`;

describe('login rate limiting', () => {
	let ip: string;
	let email: string;

	beforeEach(() => {
		ip = freshAddress();
		email = freshEmail();
	});

	it('admits an attempt from an address with no history', () => {
		expect(checkRateLimit(ip, email).allowed).toBe(true);
	});

	it('throttles one address after its cap of failures', () => {
		for (let i = 0; i < MAX_PER_ADDRESS; i++) recordFailedAttempt(ip, freshEmail());
		expect(checkRateLimit(ip, freshEmail()).allowed).toBe(false);
	});

	it('does not throttle a second address because the first failed', () => {
		for (let i = 0; i < MAX_PER_ADDRESS; i++) recordFailedAttempt(ip, freshEmail());
		expect(checkRateLimit(freshAddress(), freshEmail()).allowed).toBe(true);
	});

	it('throttles a targeted account across many source addresses', () => {
		// Each attempt comes from a fresh address, so the per-address bucket never
		// fires — only the account counter can stop this.
		let blocked = false;
		for (let i = 0; i < 40 && !blocked; i++) {
			const from = freshAddress();
			if (!checkRateLimit(from, email).allowed) blocked = true;
			else recordFailedAttempt(from, email);
		}
		expect(blocked).toBe(true);
	});

	it('keys the account bucket case- and whitespace-insensitively', () => {
		let blocked = false;
		for (let i = 0; i < 40 && !blocked; i++) {
			const from = freshAddress();
			const spelling = i % 2 === 0 ? `  ${email.toUpperCase()} ` : email;
			if (!checkRateLimit(from, spelling).allowed) blocked = true;
			else recordFailedAttempt(from, spelling);
		}
		expect(blocked).toBe(true);
	});

	it('forgives both buckets on a successful login', () => {
		for (let i = 0; i < MAX_PER_ADDRESS; i++) recordFailedAttempt(ip, email);
		expect(checkRateLimit(ip, email).allowed).toBe(false);
		clearRateLimit(ip, email);
		expect(checkRateLimit(ip, email).allowed).toBe(true);
	});

	it('falls back to address-only when there is no email (password-only login)', () => {
		for (let i = 0; i < MAX_PER_ADDRESS; i++) recordFailedAttempt(ip);
		expect(checkRateLimit(ip).allowed).toBe(false);
		expect(checkRateLimit(freshAddress()).allowed).toBe(true);
	});

	it('reports a retryAfter when it refuses', () => {
		for (let i = 0; i < MAX_PER_ADDRESS; i++) recordFailedAttempt(ip, email);
		const verdict = checkRateLimit(ip, email);
		expect(verdict.allowed).toBe(false);
		expect(verdict.retryAfter).toBeGreaterThan(0);
	});
});
