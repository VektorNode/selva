import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { resolveComputeLimits, readPositiveInt, readNonNegativeInt } from '../limits.js';
import { NoopLogger, type ILogger } from '@selvajs/platform';

/** The env readers take an injected `ILogger`, so there is nothing to spy on. */
function fakeLogger(): ILogger & { warn: Mock<ILogger['warn']> } {
	const logger = new NoopLogger() as ILogger & { warn: Mock<ILogger['warn']> };
	logger.warn = vi.fn<ILogger['warn']>();
	return logger;
}

const MB = 1024 * 1024;

/**
 * The release-gate half of these tests exists because a "TEMP (dev)" raise of the
 * upload/request caps to 300 MB once survived all the way to a release branch —
 * the only thing tracking it was a code comment nobody re-read. Bare numbers
 * can't defend themselves, so the invariants that make them correct are
 * asserted here instead.
 */
describe('resolveComputeLimits', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('defaults (release gate — see audit B3)', () => {
		it('caps .gh uploads at 50 MB, matching Rhino.Compute RHINO_COMPUTE_MAX_REQUEST_SIZE', () => {
			// Above this, compute 413s regardless — accepting more defers the failure.
			expect(resolveComputeLimits({}).maxDefinitionFileSize).toBe(50 * MB);
		});

		it('caps the /api/compute request body at 210 MB, matching the shipped BODY_SIZE_LIMIT', () => {
			// A larger cap here is dead config — adapter-node's global backstop
			// rejects first.
			expect(resolveComputeLimits({}).computeRequestMaxBytes).toBe(210 * MB);
		});

		it('caps the /api/compute response at 300 MB (intentional, not a dev leftover)', () => {
			// Above any legitimate inline payload, below V8's ~512 MB string wall.
			// Not bounded by BODY_SIZE_LIMIT, which only covers inbound bodies.
			expect(resolveComputeLimits({}).computeResponseMaxBytes).toBe(300 * MB);
		});

		it('byte-budgets the per-client solve cache at 256 MB, with 0 = off (audit C2)', () => {
			expect(resolveComputeLimits({}).computeSolveCacheBytes).toBe(256 * MB);
			expect(resolveComputeLimits({ COMPUTE_SOLVE_CACHE_MB: '0' }).computeSolveCacheBytes).toBe(0);
		});

		it('byte-budgets the definition cache at 256 MB, with 0 = off', () => {
			expect(resolveComputeLimits({}).computeDefinitionCacheBytes).toBe(256 * MB);
			expect(
				resolveComputeLimits({ COMPUTE_DEFINITION_CACHE_MB: '0' }).computeDefinitionCacheBytes
			).toBe(0);
		});

		// A var that silently stops being read looks identical to one that works,
		// so the old names need asserting, not just documenting.
		describe('renamed cache vars (2026-07)', () => {
			it('honours each old name when the new one is unset', () => {
				expect(
					resolveComputeLimits({ COMPUTE_DEFINITION_BYTE_CACHE_MB: '8' })
						.computeDefinitionCacheBytes
				).toBe(8 * MB);
				expect(
					resolveComputeLimits({ COMPUTE_RESPONSE_CACHE_MB: '8' }).computeSolveCacheBytes
				).toBe(8 * MB);
				expect(
					resolveComputeLimits({ DEFINITION_CACHE_TTL_MS: '1234' }).remoteDefinitionCacheTtlMs
				).toBe(1234);
			});

			it('honours `0` from an old name (a disable, not an absent value)', () => {
				expect(
					resolveComputeLimits({ COMPUTE_RESPONSE_CACHE_MB: '0' }).computeSolveCacheBytes
				).toBe(0);
			});

			it('prefers the new name when both are set', () => {
				expect(
					resolveComputeLimits({
						COMPUTE_SOLVE_CACHE_MB: '4',
						COMPUTE_RESPONSE_CACHE_MB: '99'
					}).computeSolveCacheBytes
				).toBe(4 * MB);
			});

			it('warns when falling back to an old name', () => {
				const warnings: string[] = [];
				const logger = {
					debug: () => {},
					info: () => {},
					warn: (msg: string) => warnings.push(msg),
					error: () => {}
				};
				resolveComputeLimits({ COMPUTE_RESPONSE_CACHE_MB: '8' }, logger as never);
				expect(warnings.some((w) => w.includes('Deprecated env var'))).toBe(true);
			});

			it('stays silent when only new names are used', () => {
				const warnings: string[] = [];
				const logger = {
					debug: () => {},
					info: () => {},
					warn: (msg: string) => warnings.push(msg),
					error: () => {}
				};
				resolveComputeLimits({ COMPUTE_SOLVE_CACHE_MB: '8' }, logger as never);
				expect(warnings).toEqual([]);
			});
		});

		describe('renamed solve deadline (2026-08)', () => {
			it('honours the old name when the new one is unset', () => {
				expect(resolveComputeLimits({ MAX_SOLVE_DURATION_MS: '45000' }).solveDeadlineMs).toBe(
					45_000
				);
			});

			it('prefers the new name when both are set', () => {
				expect(
					resolveComputeLimits({
						COMPUTE_SOLVE_DEADLINE_MS: '30000',
						MAX_SOLVE_DURATION_MS: '99000'
					}).solveDeadlineMs
				).toBe(30_000);
			});

			it('warns when falling back to the old name', () => {
				const warnings: string[] = [];
				const logger = {
					debug: () => {},
					info: () => {},
					warn: (msg: string) => warnings.push(msg),
					error: () => {}
				};
				resolveComputeLimits({ MAX_SOLVE_DURATION_MS: '45000' }, logger as never);
				expect(warnings.some((w) => w.includes('Deprecated env var'))).toBe(true);
			});
		});

		it('keeps every payload cap under V8 single-string wall (~512 MB)', () => {
			const limits = resolveComputeLimits({});
			// A `file` output is base64-embedded and JSON.stringify'd into ONE string;
			// past the wall that's a RangeError — the crash these caps prevent.
			expect(limits.computeResponseMaxBytes).toBeLessThan(512 * MB);
			expect(limits.computeRequestMaxBytes).toBeLessThan(512 * MB);
		});
	});

	describe('cross-limit invariants', () => {
		it('tracks remoteDefinitionMaxBytes to maxDefinitionFileSize so a URL cannot smuggle a larger file', () => {
			expect(resolveComputeLimits({}).remoteDefinitionMaxBytes).toBe(
				resolveComputeLimits({}).maxDefinitionFileSize
			);
		});

		it('keeps the lockstep when maxDefinitionFileSize is overridden', () => {
			const limits = resolveComputeLimits({ MAX_DEFINITION_FILE_SIZE_BYTES: String(12 * MB) });
			expect(limits.maxDefinitionFileSize).toBe(12 * MB);
			expect(limits.remoteDefinitionMaxBytes).toBe(12 * MB);
		});

		it('sizes the request cap to clear a base64-inflated max upload', () => {
			// base64 inflates ~4/3, so the binding case is a 150 MB raw `file` widget
			// input (~200 MB on the wire) plus JSON envelope slack.
			const limits = resolveComputeLimits({});
			expect(limits.computeRequestMaxBytes).toBeGreaterThan(150 * MB * (4 / 3));
		});
	});

	describe('env overrides', () => {
		it('honors explicit byte overrides', () => {
			const limits = resolveComputeLimits({
				MAX_DEFINITION_FILE_SIZE_BYTES: String(1 * MB),
				COMPUTE_REQUEST_MAX_BYTES: String(2 * MB),
				COMPUTE_RESPONSE_MAX_BYTES: String(3 * MB)
			});
			expect(limits.maxDefinitionFileSize).toBe(1 * MB);
			expect(limits.computeRequestMaxBytes).toBe(2 * MB);
			expect(limits.computeResponseMaxBytes).toBe(3 * MB);
		});

		it('is pure — the same env always resolves to the same limits', () => {
			expect(resolveComputeLimits({})).toEqual(resolveComputeLimits({}));
		});
	});
});

describe('readPositiveInt', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the fallback when the value is absent', () => {
		expect(readPositiveInt({}, 'X', 7)).toBe(7);
	});

	it('parses a valid value and floors it', () => {
		expect(readPositiveInt({ X: '42' }, 'X', 7)).toBe(42);
		expect(readPositiveInt({ X: '42.9' }, 'X', 7)).toBe(42);
	});

	it.each([
		['not-a-number', 'abc'],
		['zero', '0'],
		['negative', '-5'],
		['Infinity', 'Infinity']
	])('warns and falls back on %s', (_label, raw) => {
		const logger = fakeLogger();
		expect(readPositiveInt({ X: raw }, 'X', 7, logger)).toBe(7);
		expect(logger.warn).toHaveBeenCalledOnce();
		// Asserted on the fields, not the message: variable data belongs in fields.
		expect(logger.warn.mock.calls[0][1]).toMatchObject({ envVar: 'X', value: raw, fallback: 7 });
	});

	it('stays silent by default, so library code never writes to stdout unbidden', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(readPositiveInt({ X: 'abc' }, 'X', 7)).toBe(7);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe('readNonNegativeInt', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('accepts 0 as a real value rather than falling back', () => {
		// `0` means "disable" for budget knobs, so it must survive the parse.
		expect(readNonNegativeInt({ X: '0' }, 'X', 7)).toBe(0);
	});

	it('warns and falls back on a negative value', () => {
		const logger = fakeLogger();
		expect(readNonNegativeInt({ X: '-1' }, 'X', 7, logger)).toBe(7);
		expect(logger.warn).toHaveBeenCalledOnce();
		expect(logger.warn.mock.calls[0][1]).toMatchObject({ envVar: 'X', value: '-1', fallback: 7 });
	});
});
