import { describe, expect, it } from 'vitest';
import {
	composeManifest,
	defineSetting,
	legacyValue,
	resolveConfig,
	type EnvRecord
} from '../index.js';

const manifest = composeManifest([
	defineSetting({
		key: 'SIGN_IN_MAX_AGE_DAYS',
		type: 'int',
		min: 0,
		default: 0,
		onInvalid: 'fail',
		class: 'setting',
		description: 'Days one sign-in lasts.'
	}),
	defineSetting({
		key: 'COMPUTE_SOLVE_CACHE_MB',
		type: 'int',
		min: 0,
		default: 256,
		onInvalid: 'default',
		class: 'tunable',
		description: 'Solve cache budget.',
		aliases: ['COMPUTE_RESPONSE_CACHE_MB']
	}),
	defineSetting({
		key: 'SUPABASE_ALLOW_EMAIL_LINK_SIGNUP',
		type: 'bool',
		default: true,
		onInvalid: 'fail',
		class: 'setting',
		description: 'Magic links may create accounts.'
	}),
	defineSetting({
		key: 'SELVA_TENANCY',
		type: 'enum',
		values: ['single', 'multi'],
		default: 'single',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'One org or many.'
	}),
	defineSetting({
		key: 'SELVA_HMAC_KEY',
		type: 'string',
		minLength: 32,
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'Signing key.'
	})
]);

const KEY = 'k'.repeat(64);

describe('resolveConfig', () => {
	it('returns typed values and marks unset keys as defaults', () => {
		const result = resolveConfig(manifest, { SELVA_HMAC_KEY: KEY, SIGN_IN_MAX_AGE_DAYS: '7' });
		expect(result.values).toMatchObject({
			SIGN_IN_MAX_AGE_DAYS: 7,
			COMPUTE_SOLVE_CACHE_MB: 256,
			SUPABASE_ALLOW_EMAIL_LINK_SIGNUP: true,
			SELVA_TENANCY: 'single'
		});
		expect(result.keys.SIGN_IN_MAX_AGE_DAYS.source).toBe('env');
		expect(result.keys.COMPUTE_SOLVE_CACHE_MB.source).toBe('default');
		expect(result.errors).toEqual([]);
	});

	it('a bad value on a fail-closed key is an error, not a silent default', () => {
		const result = resolveConfig(manifest, { SELVA_HMAC_KEY: KEY, SIGN_IN_MAX_AGE_DAYS: 'seven' });
		expect(result.errors.map((e) => e.key)).toEqual(['SIGN_IN_MAX_AGE_DAYS']);
	});

	it('a bad value on a tunable falls back and is reported invalid', () => {
		const result = resolveConfig(manifest, { SELVA_HMAC_KEY: KEY, COMPUTE_SOLVE_CACHE_MB: '-1' });
		expect(result.values.COMPUTE_SOLVE_CACHE_MB).toBe(256);
		expect(result.keys.COMPUTE_SOLVE_CACHE_MB.status).toBe('invalid');
		expect(result.errors).toEqual([]);
	});

	it('booleans accept one vocabulary and reject everything else', () => {
		for (const off of ['false', 'FALSE', '0', 'no', 'off']) {
			const r = resolveConfig(manifest, {
				SELVA_HMAC_KEY: KEY,
				SUPABASE_ALLOW_EMAIL_LINK_SIGNUP: off
			});
			expect(r.values.SUPABASE_ALLOW_EMAIL_LINK_SIGNUP, off).toBe(false);
		}
		// Was fail-open: anything but the exact string "false" allowed sign-ups.
		const typo = resolveConfig(manifest, {
			SELVA_HMAC_KEY: KEY,
			SUPABASE_ALLOW_EMAIL_LINK_SIGNUP: 'nope'
		});
		expect(typo.errors.map((e) => e.key)).toEqual(['SUPABASE_ALLOW_EMAIL_LINK_SIGNUP']);
	});

	it('enums are case-insensitive and reject unknown members', () => {
		expect(
			resolveConfig(manifest, { SELVA_HMAC_KEY: KEY, SELVA_TENANCY: 'Multi' }).values.SELVA_TENANCY
		).toBe('multi');
		expect(
			resolveConfig(manifest, { SELVA_HMAC_KEY: KEY, SELVA_TENANCY: 'many' }).errors
		).toHaveLength(1);
	});

	it('a missing required key is an error', () => {
		expect(resolveConfig(manifest, {}).errors.map((e) => e.key)).toEqual(['SELVA_HMAC_KEY']);
	});

	it('reads an old name when the new one is unset, and says so', () => {
		const result = resolveConfig(manifest, {
			SELVA_HMAC_KEY: KEY,
			COMPUTE_RESPONSE_CACHE_MB: '64'
		});
		expect(result.values.COMPUTE_SOLVE_CACHE_MB).toBe(64);
		expect(result.keys.COMPUTE_SOLVE_CACHE_MB.source).toBe('alias');
		expect(result.keys.COMPUTE_SOLVE_CACHE_MB.alias).toBe('COMPUTE_RESPONSE_CACHE_MB');
	});

	it('a blank value counts as unset, under the new name or an old one', () => {
		const result = resolveConfig(manifest, {
			SELVA_HMAC_KEY: '   ',
			SIGN_IN_MAX_AGE_DAYS: ' ',
			COMPUTE_SOLVE_CACHE_MB: '  ',
			COMPUTE_RESPONSE_CACHE_MB: '64'
		});
		expect(result.errors.map((e) => [e.key, e.problem])).toEqual([
			['SELVA_HMAC_KEY', 'is required']
		]);
		expect(result.keys.SIGN_IN_MAX_AGE_DAYS).toMatchObject({ source: 'default', value: 0 });
		expect(result.keys.COMPUTE_SOLVE_CACHE_MB).toMatchObject({ source: 'alias', value: 64 });
	});

	it('a whole number is digits with an optional sign, nothing else', () => {
		const read = (raw: string) =>
			resolveConfig(manifest, { SELVA_HMAC_KEY: KEY, SIGN_IN_MAX_AGE_DAYS: raw }).keys
				.SIGN_IN_MAX_AGE_DAYS;
		for (const raw of ['0x10', '0b11', '1e3', '7.0', '99999999999999999999']) {
			expect(read(raw).status, raw).toBe('error');
		}
		expect(read('+7').value).toBe(7);
		expect(Object.is(read('-0').value, 0)).toBe(true);
	});

	it('reports undeclared keys under watched prefixes with the nearest declared name', () => {
		const result = resolveConfig(
			manifest,
			{ SELVA_HMAC_KEY: KEY, SIGN_IN_MAX_AGE: '7', SELVA_TENANCYY: 'multi', PATH: '/usr/bin' },
			{ prefixes: ['SELVA_', 'SIGN_IN_'] }
		);
		expect(result.unknown).toEqual([
			{ key: 'SIGN_IN_MAX_AGE', suggestion: 'SIGN_IN_MAX_AGE_DAYS' },
			{ key: 'SELVA_TENANCYY', suggestion: 'SELVA_TENANCY' }
		]);
	});

	it('external keys a host declares are not reported as unknown', () => {
		const result = resolveConfig(
			manifest,
			{ SELVA_HMAC_KEY: KEY, SELVA_SOMETHING_ELSE: 'x' },
			{ prefixes: ['SELVA_'], external: ['SELVA_SOMETHING_ELSE'] }
		);
		expect(result.unknown).toEqual([]);
	});

	it('an old name is not reported as unknown', () => {
		const result = resolveConfig(
			manifest,
			{ SELVA_HMAC_KEY: KEY, COMPUTE_RESPONSE_CACHE_MB: '64' },
			{ prefixes: ['COMPUTE_'] }
		);
		expect(result.unknown).toEqual([]);
	});

	it('composing two slices that declare the same key throws', () => {
		const dup = defineSetting({
			key: 'SELVA_TENANCY',
			type: 'string',
			onInvalid: 'fail',
			class: 'bootstrap',
			description: 'x'
		});
		expect(() => composeManifest([manifest, [dup]])).toThrow(/SELVA_TENANCY/);
	});
});

describe('url, list, int and string rules', () => {
	const types = composeManifest([
		defineSetting({
			key: 'ORIGIN',
			type: 'url',
			origin: true,
			onInvalid: 'fail',
			class: 'bootstrap',
			description: 'Public URL.'
		}),
		defineSetting({
			key: 'SUPABASE_URL',
			type: 'url',
			onInvalid: 'fail',
			class: 'bootstrap',
			description: 'Supabase project URL.'
		}),
		defineSetting({
			key: 'MCP_ALLOWED_ORIGINS',
			type: 'list',
			default: [],
			onInvalid: 'fail',
			class: 'setting',
			description: 'Extra MCP origins.'
		}),
		defineSetting({
			key: 'COMPUTE_RATE_LIMIT_MAX',
			type: 'int',
			min: 1,
			max: 10_000,
			default: 120,
			onInvalid: 'default',
			class: 'tunable',
			description: 'Solves per minute.'
		}),
		defineSetting({
			key: 'SMTP_PASS',
			type: 'string',
			minLength: 8,
			onInvalid: 'fail',
			class: 'secret',
			description: 'SMTP password.'
		})
	]);
	const resolve = (env: EnvRecord) => resolveConfig(types, env).keys;

	it('a url drops trailing slashes and keeps its path', () => {
		const keys = resolve({
			ORIGIN: 'https://selva.example.com/',
			SUPABASE_URL: 'http://127.0.0.1:54421/rest/'
		});
		expect(keys.ORIGIN.value).toBe('https://selva.example.com');
		expect(keys.SUPABASE_URL.value).toBe('http://127.0.0.1:54421/rest');
	});

	it.each([
		'localhost:3000',
		'selva.example.com:443',
		'javascript:alert(1)',
		'ftp://selva.example.com'
	])('a url must be http or https: %s', (raw) => {
		expect(resolve({ SUPABASE_URL: raw }).SUPABASE_URL.status).toBe('error');
	});

	it.each([
		'https://selva.example.com/app',
		'https://selva.example.com?next=/',
		'https://admin:pw@selva.example.com'
	])('an origin refuses a path, query or credentials: %s', (raw) => {
		expect(resolve({ ORIGIN: raw }).ORIGIN.status).toBe('error');
		expect(resolve({ SUPABASE_URL: raw }).SUPABASE_URL.status).toBe('ok');
	});

	it('a list splits on commas and drops blanks', () => {
		expect(
			resolve({ MCP_ALLOWED_ORIGINS: ' https://a.example , ,https://b.example ' })
				.MCP_ALLOWED_ORIGINS.value
		).toEqual(['https://a.example', 'https://b.example']);
	});

	it('an int above its max falls back to the default', () => {
		expect(resolve({ COMPUTE_RATE_LIMIT_MAX: '10001' }).COMPUTE_RATE_LIMIT_MAX).toMatchObject({
			status: 'invalid',
			value: 120,
			problem: 'must be ≤ 10000'
		});
	});

	it('a string shorter than its minLength is refused', () => {
		expect(resolve({ SMTP_PASS: 'short' }).SMTP_PASS).toMatchObject({
			status: 'error',
			problem: 'must be at least 8 characters'
		});
	});
});

describe('key type', () => {
	const keys = composeManifest([
		defineSetting({
			key: 'SELVA_AT_REST_KEY',
			type: 'key',
			required: true,
			onInvalid: 'fail',
			class: 'secret',
			sensitive: true,
			generated: true,
			description: 'Encryption key.'
		})
	]);

	it('accepts 32 bytes as hex or base64, and rejects anything else', () => {
		const hex = 'ab'.repeat(32);
		const b64 = Buffer.alloc(32, 9).toString('base64');
		expect(resolveConfig(keys, { SELVA_AT_REST_KEY: hex }).errors).toEqual([]);
		expect(resolveConfig(keys, { SELVA_AT_REST_KEY: b64 }).errors).toEqual([]);
		expect(resolveConfig(keys, { SELVA_AT_REST_KEY: 'ab'.repeat(31) }).errors).toHaveLength(1);
		expect(
			resolveConfig(keys, { SELVA_AT_REST_KEY: 'replace-this-with-a-random-32-byte-hex-key' })
				.errors
		).toHaveLength(1);
	});
});

describe('legacyValue', () => {
	it('reads a value the way the reader did before it parsed strictly', () => {
		const exactTrue = defineSetting({
			key: 'SUPABASE_ENABLE_SELF_SIGNUP',
			type: 'bool',
			default: false,
			onInvalid: 'fail',
			class: 'setting',
			description: 'x',
			legacy: { bool: 'exact-true' }
		});
		const notFalse = defineSetting({
			key: 'SUPABASE_ALLOW_EMAIL_LINK_SIGNUP',
			type: 'bool',
			default: true,
			onInvalid: 'fail',
			class: 'setting',
			description: 'x',
			legacy: { bool: 'not-false' }
		});
		const fallback = defineSetting({
			key: 'SUPABASE_TOKEN_VERIFICATION',
			type: 'enum',
			values: ['hybrid', 'strict'],
			default: 'hybrid',
			onInvalid: 'fail',
			class: 'tunable',
			description: 'x',
			legacy: { enumFallback: 'hybrid' }
		});
		expect(legacyValue(exactTrue, '1')).toBe(false);
		expect(legacyValue(exactTrue, 'true')).toBe(true);
		expect(legacyValue(notFalse, 'nope')).toBe(true);
		expect(legacyValue(notFalse, 'false')).toBe(false);
		expect(legacyValue(fallback, 'Strict')).toBe('hybrid');
		expect(legacyValue(fallback, 'strict')).toBe('strict');
	});
});
