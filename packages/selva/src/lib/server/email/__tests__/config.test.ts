/**
 * Mail is optional. The rules that matter:
 *   - no SMTP_HOST ⇒ null, meaning "not configured", never an error
 *   - SMTP_HOST without SMTP_FROM ⇒ throw, because a half-config that silently
 *     never sends is worse than a loud failure
 *   - TLS mode is inferred from the port unless SMTP_SECURE overrides it
 */

import { describe, it, expect, afterEach } from 'vitest';
import { env } from '$env/dynamic/private';
import { readSmtpConfig } from '../config';
import { isMailConfigured } from '../mailer';

const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE'];

afterEach(() => {
	for (const k of KEYS) delete env[k];
});

describe('readSmtpConfig', () => {
	it('returns null when SMTP_HOST is unset', () => {
		expect(readSmtpConfig()).toBeNull();
		expect(isMailConfigured()).toBe(false);
	});

	it('throws when a host is set but no sender address is', () => {
		env.SMTP_HOST = 'smtp.example.com';
		expect(() => readSmtpConfig()).toThrow(/SMTP_FROM/);
		// A throwing config must read as "cannot send", not crash the page load.
		expect(isMailConfigured()).toBe(false);
	});

	it('defaults to port 587 with STARTTLS', () => {
		env.SMTP_HOST = 'smtp.example.com';
		env.SMTP_FROM = 'no-reply@example.com';
		const cfg = readSmtpConfig()!;
		expect(cfg.port).toBe(587);
		expect(cfg.secure).toBe(false);
		expect(cfg.auth).toBeUndefined();
		expect(isMailConfigured()).toBe(true);
	});

	it('infers implicit TLS on port 465', () => {
		env.SMTP_HOST = 'smtp.example.com';
		env.SMTP_FROM = 'no-reply@example.com';
		env.SMTP_PORT = '465';
		expect(readSmtpConfig()!.secure).toBe(true);
	});

	it('lets SMTP_SECURE override the port-derived TLS mode', () => {
		env.SMTP_HOST = 'smtp.example.com';
		env.SMTP_FROM = 'no-reply@example.com';
		env.SMTP_PORT = '465';
		env.SMTP_SECURE = 'false';
		expect(readSmtpConfig()!.secure).toBe(false);
	});

	it('falls back to 587 on a nonsense port rather than passing it through', () => {
		env.SMTP_HOST = 'smtp.example.com';
		env.SMTP_FROM = 'no-reply@example.com';
		env.SMTP_PORT = 'not-a-number';
		expect(readSmtpConfig()!.port).toBe(587);
	});

	it('sets auth only when both user and pass are present', () => {
		env.SMTP_HOST = 'smtp.example.com';
		env.SMTP_FROM = 'no-reply@example.com';
		env.SMTP_USER = 'apikey';
		expect(readSmtpConfig()!.auth).toBeUndefined();

		env.SMTP_PASS = 'secret';
		expect(readSmtpConfig()!.auth).toEqual({ user: 'apikey', pass: 'secret' });
	});
});
