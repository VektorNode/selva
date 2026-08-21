/**
 * Mail is optional. The rules that matter:
 *   - no SMTP_HOST ⇒ null, meaning "not configured", never an error
 *   - SMTP_HOST without SMTP_FROM ⇒ throw, because a half-config that silently
 *     never sends is worse than a loud failure
 *   - TLS mode is inferred from the port unless SMTP_SECURE overrides it
 */

import { describe, it, expect } from 'vitest';
import { readSmtpConfig, type SmtpEnv } from '../smtp-config.js';
import { SmtpNotificationProvider } from '../smtp-provider.js';

const isConfigured = (env: SmtpEnv) => new SmtpNotificationProvider(env).isConfigured();

describe('readSmtpConfig', () => {
	it('returns null when SMTP_HOST is unset', () => {
		expect(readSmtpConfig({})).toBeNull();
		expect(isConfigured({})).toBe(false);
	});

	it('throws when a host is set but no sender address is', () => {
		const env: SmtpEnv = { SMTP_HOST: 'smtp.example.com' };
		expect(() => readSmtpConfig(env)).toThrow(/SMTP_FROM/);
		// A throwing config must read as "cannot send", not crash the page load.
		expect(isConfigured(env)).toBe(false);
	});

	it('defaults to port 587 with STARTTLS', () => {
		const env: SmtpEnv = { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'no-reply@example.com' };
		const cfg = readSmtpConfig(env)!;
		expect(cfg.port).toBe(587);
		expect(cfg.secure).toBe(false);
		expect(cfg.auth).toBeUndefined();
		expect(isConfigured(env)).toBe(true);
	});

	it('infers implicit TLS on port 465', () => {
		expect(
			readSmtpConfig({
				SMTP_HOST: 'smtp.example.com',
				SMTP_FROM: 'no-reply@example.com',
				SMTP_PORT: '465'
			})!.secure
		).toBe(true);
	});

	it('lets SMTP_SECURE override the port-derived TLS mode', () => {
		expect(
			readSmtpConfig({
				SMTP_HOST: 'smtp.example.com',
				SMTP_FROM: 'no-reply@example.com',
				SMTP_PORT: '465',
				SMTP_SECURE: 'false'
			})!.secure
		).toBe(false);
	});

	it('falls back to 587 on a nonsense port rather than passing it through', () => {
		expect(
			readSmtpConfig({
				SMTP_HOST: 'smtp.example.com',
				SMTP_FROM: 'no-reply@example.com',
				SMTP_PORT: 'not-a-number'
			})!.port
		).toBe(587);
	});

	it('sets auth only when both user and pass are present', () => {
		const base: SmtpEnv = {
			SMTP_HOST: 'smtp.example.com',
			SMTP_FROM: 'no-reply@example.com',
			SMTP_USER: 'apikey'
		};
		expect(readSmtpConfig(base)!.auth).toBeUndefined();
		expect(readSmtpConfig({ ...base, SMTP_PASS: 'secret' })!.auth).toEqual({
			user: 'apikey',
			pass: 'secret'
		});
	});
});

describe('SmtpNotificationProvider', () => {
	it('reports not-configured rather than throwing when mail is off', async () => {
		const result = await new SmtpNotificationProvider({}).send({
			kind: 'org.invite',
			to: 'someone@example.test',
			subject: 's',
			text: 't',
			html: '<p>t</p>'
		});
		expect(result).toEqual({ status: 'not-configured' });
	});

	it('reports a half-finished config as failed instead of throwing', async () => {
		// The caller has already committed its write by the time it sends, so a
		// bad config must come back as a value, never as an exception.
		const result = await new SmtpNotificationProvider({ SMTP_HOST: 'smtp.example.com' }).send({
			kind: 'org.invite',
			to: 'someone@example.test',
			subject: 's',
			text: 't',
			html: '<p>t</p>'
		});
		expect(result).toEqual({ status: 'failed', reason: 'misconfigured' });
	});
});
