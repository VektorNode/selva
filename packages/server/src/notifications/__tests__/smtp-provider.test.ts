import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ILogger, OutboundMessage } from '@selvajs/platform';
import { SmtpNotificationProvider } from '../smtp-provider.js';

const sendMail = vi.fn();
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }) }));

const message = {
	to: 'person@acme.test',
	subject: 's',
	text: 't',
	html: 'h',
	kind: 'invite'
} as unknown as OutboundMessage;

afterEach(() => vi.clearAllMocks());

describe('SmtpNotificationProvider failures', () => {
	it('keeps the recipient out of everything it logs and returns', async () => {
		const failure = Object.assign(new Error('550 <person@acme.test>: no such user'), {
			code: 'EENVELOPE',
			responseCode: 550
		});
		sendMail.mockRejectedValueOnce(failure);
		const warn = vi.fn();
		const provider = new SmtpNotificationProvider({ SMTP_HOST: 'h', SMTP_FROM: 'f@x.io' });

		const result = await provider.send(message, { warn } as unknown as ILogger);

		expect(warn).toHaveBeenCalledOnce();
		const output = JSON.stringify([warn.mock.calls, result]);
		expect(output).not.toContain('person@acme.test');
		expect(warn.mock.calls[0][1]).toMatchObject({ code: 'EENVELOPE', responseCode: 550 });
		expect(result).toEqual({ status: 'failed', reason: 'EENVELOPE' });
	});

	it('still lets two failures to one recipient be matched up', async () => {
		sendMail.mockRejectedValue(new Error('down'));
		const warn = vi.fn();
		const provider = new SmtpNotificationProvider({ SMTP_HOST: 'h', SMTP_FROM: 'f@x.io' });

		await provider.send(message, { warn } as unknown as ILogger);
		await provider.send(message, { warn } as unknown as ILogger);

		const [first, second] = warn.mock.calls.map((c) => c[1].recipient);
		expect(first).toEqual(expect.any(String));
		expect(first).toBe(second);
	});
});
