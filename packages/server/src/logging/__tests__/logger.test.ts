import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('createLogger', () => {
	it('returns a working logger (pino when installed, console otherwise)', async () => {
		// Asserted loosely on purpose: pino is an optional peer, so which backend
		// you get varies by install. Always an ILogger, never null, never a throw.
		const logger = await createLogger({ level: 'debug' });
		expect(() => logger.info('boot', { component: 'test' })).not.toThrow();
		expect(logger.child({ requestId: 'r-1' })).toBeDefined();
	});
});
