import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ILogger } from '@selvajs/platform';
import { ConsoleLogger, createLogger } from '../PinoLogger.js';

afterEach(() => vi.restoreAllMocks());

describe('ConsoleLogger', () => {
	it('routes error/warn to the matching console method', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});

		const logger = new ConsoleLogger({}, 'debug');
		logger.error('bad');
		logger.warn('odd');
		logger.info('fyi');

		expect(error).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledOnce();
	});

	it('drops records below the configured level', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const logger = new ConsoleLogger({}, 'warn');
		logger.debug('noise');
		logger.info('noise');
		expect(log).not.toHaveBeenCalled();

		logger.warn('kept');
		expect(warn).toHaveBeenCalledOnce();
	});

	it('renders bound fields alongside the message', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		new ConsoleLogger({}, 'info').info('solved', { durationMs: 12 });
		expect(log.mock.calls[0][0]).toBe('INFO solved {"durationMs":12}');
	});

	it('child fields ride along on every record — the correlation contract', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const child = new ConsoleLogger({}, 'info').child({ requestId: 'r-1' });
		child.info('hello');
		expect(log.mock.calls[0][0]).toContain('"requestId":"r-1"');
	});

	it('composes child fields and lets the child win a collision', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		new ConsoleLogger({}, 'info')
			.child({ requestId: 'r-1', component: 'outer' })
			.child({ component: 'inner' })
			.info('hello');
		const line = log.mock.calls[0][0] as string;
		expect(line).toContain('"requestId":"r-1"');
		expect(line).toContain('"component":"inner"');
		expect(line).not.toContain('outer');
	});

	it('does not mutate the parent when a child is derived', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const parent = new ConsoleLogger({}, 'info');
		parent.child({ requestId: 'r-1' });
		parent.info('unbound');
		expect(log.mock.calls[0][0]).toBe('INFO unbound');
	});

	it('never throws on an unserializable field', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => new ConsoleLogger({}, 'info').info('cyclic', { cyclic })).not.toThrow();
		expect(log.mock.calls[0][0]).toContain('[unserializable]');
	});
});

/** One record carrying every kind of credential the redaction list names. */
function logSecrets(logger: ILogger): void {
	logger.child({ requestId: 'r-1', authorization: 'Bearer bound-secret' }).warn('rejected', {
		apiKey: 'top-secret',
		password: 'hunter2',
		cookie: 'sid=cookie-secret',
		headers: { Authorization: 'Bearer nested-secret' },
		server: { id: 's-1', apiKey: 'nested-key' }
	});
}

function expectRedacted(output: string): void {
	for (const secret of [
		'bound-secret',
		'top-secret',
		'hunter2',
		'cookie-secret',
		'nested-secret',
		'nested-key'
	]) {
		expect(output).not.toContain(secret);
	}
	expect(output).toContain('[redacted]');
	expect(output).toContain('"requestId":"r-1"');
	expect(output).toContain('"id":"s-1"');
}

describe('redaction', () => {
	it('scrubs credentials from console output, bound fields included', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		logSecrets(new ConsoleLogger({}, 'info'));
		expectRedacted(warn.mock.calls.map((c) => String(c[0])).join('\n'));
	});

	it("leaves the caller's fields untouched", () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const fields = { apiKey: 'k', server: { apiKey: 'k' } };
		new ConsoleLogger({}, 'info').info('x', fields);
		expect(fields).toEqual({ apiKey: 'k', server: { apiKey: 'k' } });
	});

	it('scrubs credentials from pino output', async () => {
		const lines: string[] = [];
		vi.doMock('pino', async () => {
			const real = ((await vi.importActual('pino')) as { default: (...a: unknown[]) => unknown })
				.default;
			return { default: (opts: unknown) => real(opts, { write: (l: string) => lines.push(l) }) };
		});
		try {
			logSecrets(await createLogger());
		} finally {
			vi.doUnmock('pino');
		}
		expect(lines).toHaveLength(1);
		expectRedacted(lines[0]);
	});
});

describe('createLogger', () => {
	it('returns a working logger (pino when installed, console otherwise)', async () => {
		// Asserted loosely on purpose: pino is an optional peer, so which backend
		// you get varies by install. Always an ILogger, never null, never a throw.
		const logger = await createLogger({ level: 'debug' });
		expect(() => logger.info('boot', { component: 'test' })).not.toThrow();
	});
});
